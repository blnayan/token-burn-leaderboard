/** @jsxRuntime automatic */
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AppNav } from "@/components/app-nav";
import { DisplayNameForm, type DisplayNameFormState } from "@/components/display-name-form";
import { SignInWithGitHubButton } from "@/components/session-controls";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { prisma } from "@/lib/prisma";
import { normalizeDisplayName } from "@/server/display-name";

import { SetupCommandCopy } from "./setup-command-copy";

export async function updateDisplayName(
  _state: DisplayNameFormState,
  formData: FormData,
): Promise<DisplayNameFormState> {
  "use server";

  const session = await auth();
  const githubId = session?.user?.githubId;
  if (!githubId) return { message: "You must sign in with GitHub" };

  const user = await prisma.user.findUnique({
    where: { githubId },
    select: { member: { select: { id: true } } },
  });

  if (!user?.member) return { message: "You must accept an invite before setting a display name" };

  const value = String(formData.get("displayName") ?? "");
  let displayName: string;

  try {
    displayName = normalizeDisplayName(value);
  } catch (error) {
    if (error instanceof Error) return { message: error.message, value };
    throw error;
  }

  await prisma.member.update({
    where: { id: user.member.id },
    data: { displayName },
  });

  redirect("/setup");
}

export default async function SetupPage() {
  const session = await auth();
  const appNav = await AppNav({ session, currentPath: "/setup" });

  if (!session?.user) {
    return (
      <>
        {appNav}
        <main className="mx-auto flex w-full max-w-md flex-col justify-center gap-6 px-5 py-16">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold">Finish Token Burn Setup</h1>
            <p className="text-sm text-muted-foreground">Sign in with GitHub to continue setup.</p>
          </div>
          <SignInWithGitHubButton redirectTo="/setup" />
        </main>
      </>
    );
  }

  const githubId = session.user.githubId;
  const user = githubId
    ? await prisma.user.findUnique({
        where: { githubId },
        select: { member: { select: { id: true, displayName: true } } },
      })
    : null;

  if (!user?.member) {
    return (
      <>
        {appNav}
        <main className="mx-auto flex w-full max-w-md flex-col justify-center gap-4 px-5 py-16">
          <h1 className="text-3xl font-semibold">Invite Required</h1>
          <p className="text-sm text-muted-foreground">Accept an invite before setting up Token Burn sync.</p>
          <Button asChild className="w-fit">
            <Link href="/">Go to leaderboard</Link>
          </Button>
        </main>
      </>
    );
  }

  return (
    <>
      {appNav}
      <main className="mx-auto flex w-full max-w-2xl flex-col justify-center gap-6 px-5 py-16">
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
              <Dialog>
                <DialogTrigger asChild>
                  <Button type="button" variant="outline" className="w-fit">
                    Edit display name
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Edit display name</DialogTitle>
                    <DialogDescription>
                      Choose the public name shown on the Token Burn leaderboard.
                    </DialogDescription>
                  </DialogHeader>
                  <DisplayNameForm action={updateDisplayName} defaultValue={user.member.displayName} />
                </DialogContent>
              </Dialog>
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
    </>
  );
}
