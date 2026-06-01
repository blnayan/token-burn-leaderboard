import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createInviteCode, createInviteExpiration, hashInviteCode } from "@/server/invites";

async function signInWithGitHub() {
  "use server";

  await signIn("github", { redirectTo: "/admin/invites" });
}

async function createInvite() {
  "use server";

  const session = await auth();
  const githubLogin = session?.user?.githubLogin;
  if (!githubLogin) throw new Error("You must sign in with GitHub");

  const user = await prisma.user.findUnique({
    where: { githubLogin },
    select: { id: true, githubLogin: true },
  });

  if (!user || user.githubLogin !== env.ADMIN_GITHUB_LOGIN) throw new Error("Admin access is required");

  const code = createInviteCode();
  await prisma.invite.create({
    data: {
      codeHash: hashInviteCode(code),
      createdById: user.id,
      expiresAt: createInviteExpiration(),
    },
  });

  redirect(`/admin/invites?code=${encodeURIComponent(code)}`);
}

export default async function AdminInvitesPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const session = await auth();

  if (!session?.user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 px-5 py-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold">Invites</h1>
          <p className="text-sm text-muted-foreground">Sign in with GitHub to manage member invites.</p>
        </div>
        <form action={signInWithGitHub}>
          <Button type="submit">Sign in with GitHub</Button>
        </form>
      </main>
    );
  }

  const githubLogin = session.user.githubLogin;
  const user = githubLogin
    ? await prisma.user.findUnique({
        where: { githubLogin },
        select: { githubLogin: true },
      })
    : null;

  if (!user || user.githubLogin !== env.ADMIN_GITHUB_LOGIN) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-4 px-5 py-8">
        <h1 className="text-3xl font-semibold">Admin Required</h1>
        <p className="text-sm text-muted-foreground">Only the configured admin can create invites.</p>
      </main>
    );
  }

  const { code } = await searchParams;
  const inviteUrl = code ? `${env.TOKEN_BURN_PUBLIC_URL.replace(/\/$/, "")}/invite/${code}` : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 px-5 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Invites</h1>
        <p className="text-sm text-muted-foreground">Create a one-time member invite that expires in seven days.</p>
      </div>

      <form action={createInvite}>
        <Button type="submit">Create invite</Button>
      </form>

      {inviteUrl ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="inviteUrl">Invite URL</Label>
          <Input id="inviteUrl" value={inviteUrl} readOnly />
        </div>
      ) : null}
    </main>
  );
}
