import { redirect } from "next/navigation";

import { signIn, auth } from "@/auth";
import { SessionControls, SignInWithGitHubButton } from "@/components/session-controls";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createDefaultDisplayName } from "@/server/display-name";
import { hashInviteCode, isInviteExpired } from "@/server/invites";

export async function acceptInvite(formData: FormData) {
  "use server";

  const code = String(formData.get("code") ?? "");
  const session = await auth();
  const githubId = session?.user?.githubId;

  if (!githubId) {
    await signIn("github", { redirectTo: `/invite/${encodeURIComponent(code)}` });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { githubId },
    select: { id: true, githubLogin: true, githubName: true },
  });

  if (!user) throw new Error("Authenticated GitHub user was not found");

  const codeHash = hashInviteCode(code);
  const invite = await prisma.invite.findUnique({
    where: { codeHash },
    select: { id: true, redeemedAt: true, expiresAt: true },
  });

  if (!invite || invite.redeemedAt || isInviteExpired(invite.expiresAt)) {
    throw new Error("Invite is invalid or expired");
  }

  await prisma.$transaction(async (tx) => {
    await tx.member.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        username: user.githubLogin,
        displayName: createDefaultDisplayName({
          githubName: user.githubName,
          githubLogin: user.githubLogin,
        }),
      },
      update: {},
    });

    const redeemed = await tx.invite.updateMany({
      where: {
        id: invite.id,
        redeemedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        redeemedAt: new Date(),
        redeemedById: user.id,
      },
    });

    if (redeemed.count !== 1) throw new Error("Invite is invalid or expired");
  });

  redirect("/setup");
}

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await auth();
  const invite = await prisma.invite.findUnique({
    where: { codeHash: hashInviteCode(code) },
    select: { redeemedAt: true, expiresAt: true },
  });
  const unavailable = !invite || invite.redeemedAt || isInviteExpired(invite.expiresAt);

  const invitePath = `/invite/${encodeURIComponent(code)}`;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Join Token Burn</h1>
        <p className="text-sm text-muted-foreground">
          Accept your invite with GitHub, then choose the display name shown on the leaderboard.
        </p>
      </div>

      {unavailable ? (
        <p className="rounded-md border px-4 py-3 text-sm text-muted-foreground">This invite is invalid or expired.</p>
      ) : session?.user ? (
        <div className="flex flex-col gap-4">
          <form action={acceptInvite} className="flex flex-col gap-4">
            <input type="hidden" name="code" value={code} />
            <Button type="submit">Accept invite</Button>
          </form>
          <SessionControls session={session} redirectTo={invitePath} />
        </div>
      ) : (
        <SignInWithGitHubButton redirectTo={invitePath} />
      )}

      <a className="text-sm text-muted-foreground underline-offset-4 hover:underline" href={env.TOKEN_BURN_PUBLIC_URL}>
        Back to leaderboard
      </a>
    </main>
  );
}
