import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { hashSecret, isCliLoginExpired } from "@/server/cli-auth";

async function approveCliLogin(formData: FormData) {
  "use server";

  const code = String(formData.get("code") ?? "");
  const session = await auth();
  const githubId = session?.user?.githubId;

  if (!githubId) {
    await signIn("github", { redirectTo: `/cli/approve/${encodeURIComponent(code)}` });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { githubId },
    select: { member: { select: { id: true } } },
  });

  if (!user?.member) throw new Error("Token Burn membership is required");

  const approved = await prisma.cliLoginSession.updateMany({
    where: {
      codeHash: hashSecret(code),
      approvedAt: null,
      expiresAt: { gt: new Date() },
      memberId: null,
    },
    data: {
      approvedAt: new Date(),
      memberId: user.member.id,
    },
  });

  if (approved.count !== 1) throw new Error("CLI login session is invalid or expired");

  redirect(`/cli/approve/${encodeURIComponent(code)}?approved=1`);
}

async function signInWithGitHub({ code }: { code: string }) {
  "use server";

  await signIn("github", { redirectTo: `/cli/approve/${encodeURIComponent(code)}` });
}

export default async function CliApprovePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ approved?: string }>;
}) {
  const { code } = await params;
  const { approved } = await searchParams;
  const session = await auth();

  const loginSession = await prisma.cliLoginSession.findUnique({
    where: { codeHash: hashSecret(code) },
    select: {
      approvedAt: true,
      expiresAt: true,
      memberId: true,
    },
  });
  const unavailable = !loginSession || isCliLoginExpired(loginSession.expiresAt);

  if (!session?.user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold">Approve CLI Login</h1>
          <p className="text-sm text-muted-foreground">Sign in with GitHub to connect the Token Burn CLI.</p>
        </div>
        {unavailable ? (
          <p className="rounded-md border px-4 py-3 text-sm text-muted-foreground">
            This CLI login session is invalid or expired.
          </p>
        ) : (
          <form action={signInWithGitHub.bind(null, { code })}>
            <Button type="submit">Sign in with GitHub</Button>
          </form>
        )}
      </main>
    );
  }

  const githubId = session.user.githubId;
  const user = githubId
    ? await prisma.user.findUnique({
        where: { githubId },
        select: { member: { select: { displayName: true } } },
      })
    : null;

  if (!user?.member) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-5 py-8">
        <h1 className="text-3xl font-semibold">Membership Required</h1>
        <p className="text-sm text-muted-foreground">Accept an invite before connecting the Token Burn CLI.</p>
        <a className="text-sm text-muted-foreground underline-offset-4 hover:underline" href={env.TOKEN_BURN_PUBLIC_URL}>
          Back to leaderboard
        </a>
      </main>
    );
  }

  const alreadyApproved = Boolean(loginSession?.approvedAt || approved === "1");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Approve CLI Login</h1>
        <p className="text-sm text-muted-foreground">
          Connect the Token Burn CLI as {user.member.displayName}.
        </p>
      </div>

      {unavailable ? (
        <p className="rounded-md border px-4 py-3 text-sm text-muted-foreground">
          This CLI login session is invalid or expired.
        </p>
      ) : alreadyApproved ? (
        <p className="rounded-md border px-4 py-3 text-sm text-muted-foreground">
          CLI login approved. You can return to your terminal.
        </p>
      ) : (
        <form action={approveCliLogin} className="flex flex-col gap-4">
          <input type="hidden" name="code" value={code} />
          <Button type="submit">Approve CLI login</Button>
        </form>
      )}
    </main>
  );
}
