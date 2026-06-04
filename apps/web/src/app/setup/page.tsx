/** @jsxRuntime automatic */
import Link from "next/link";

import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";

import { SetupCommandCopy } from "./setup-command-copy";

async function signInWithGitHub() {
  "use server";

  await signIn("github", { redirectTo: "/setup" });
}

export default async function SetupPage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold">Finish Token Burn Setup</h1>
          <p className="text-sm text-muted-foreground">Sign in with GitHub to continue setup.</p>
        </div>
        <form action={signInWithGitHub}>
          <Button type="submit">Sign in with GitHub</Button>
        </form>
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
        <h1 className="text-3xl font-semibold">Invite Required</h1>
        <p className="text-sm text-muted-foreground">Accept an invite before setting up Token Burn sync.</p>
        <Button asChild className="w-fit">
          <Link href="/">Go to leaderboard</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-6 px-5 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Finish Token Burn Setup</h1>
        <p className="text-sm text-muted-foreground">
          Your invite is accepted. Finish these steps to start syncing usage to the leaderboard.
        </p>
      </div>

      <ol className="flex flex-col gap-4">
        <li className="rounded-md border px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-medium">Set your display name</h2>
              <p className="text-sm text-muted-foreground">
                You are currently shown as {user.member.displayName}.
              </p>
            </div>
            <Button asChild variant="outline" className="w-fit">
              <Link href="/settings/display-name">Edit display name</Link>
            </Button>
          </div>
        </li>

        <li className="rounded-md border px-4 py-3">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-medium">Run CLI setup</h2>
              <p className="text-sm text-muted-foreground">
                Open a terminal on the device you want to track and run this command.
              </p>
            </div>
            <SetupCommandCopy />
          </div>
        </li>

        <li className="rounded-md border px-4 py-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-medium">Finish the terminal prompts</h2>
            <p className="text-sm text-muted-foreground">
              Setup signs in, runs the first sync, and installs automatic sync every 15 minutes.
            </p>
          </div>
        </li>
      </ol>

      <Button asChild className="w-fit">
        <Link href="/">Go to leaderboard</Link>
      </Button>
    </main>
  );
}
