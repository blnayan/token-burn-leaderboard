import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { SessionControls, SignInWithGitHubButton } from "@/components/session-controls";
import { prisma } from "@/lib/prisma";
import { normalizeDisplayName } from "@/server/display-name";

import { DisplayNameForm } from "./display-name-form";

export type DisplayNameFormState = {
  message: string | null;
  value?: string;
};

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

  redirect("/");
}

export default async function DisplayNamePage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold">Set Display Name</h1>
          <p className="text-sm text-muted-foreground">Sign in with GitHub to continue member setup.</p>
        </div>
        <SignInWithGitHubButton redirectTo="/settings/display-name" />
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
        <p className="text-sm text-muted-foreground">Accept an invite before choosing a leaderboard display name.</p>
        <SessionControls session={session} redirectTo="/settings/display-name" />
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Set Display Name</h1>
        <p className="text-sm text-muted-foreground">Choose the public name shown on the Token Burn leaderboard.</p>
      </div>
      <DisplayNameForm action={updateDisplayName} defaultValue={user.member.displayName} />
      <SessionControls session={session} redirectTo="/settings/display-name" />
    </main>
  );
}
