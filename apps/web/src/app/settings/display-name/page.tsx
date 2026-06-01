import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { prisma } from "@/lib/prisma";
import { normalizeDisplayName } from "@/server/display-name";

async function signInWithGitHub() {
  "use server";

  await signIn("github", { redirectTo: "/settings/display-name" });
}

async function updateDisplayName(formData: FormData) {
  "use server";

  const session = await auth();
  const githubLogin = session?.user?.githubLogin;
  if (!githubLogin) throw new Error("You must sign in with GitHub");

  const user = await prisma.user.findUnique({
    where: { githubLogin },
    select: { member: { select: { id: true } } },
  });

  if (!user?.member) throw new Error("You must accept an invite before setting a display name");

  const displayName = normalizeDisplayName(String(formData.get("displayName") ?? ""));

  try {
    await prisma.member.update({
      where: { id: user.member.id },
      data: { displayName },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("Display name is already taken");
    }

    throw error;
  }

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
        select: { member: { select: { displayName: true } } },
      })
    : null;

  if (!user?.member) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-5 py-8">
        <h1 className="text-3xl font-semibold">Invite Required</h1>
        <p className="text-sm text-muted-foreground">Accept an invite before choosing a leaderboard display name.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Set Display Name</h1>
        <p className="text-sm text-muted-foreground">Choose the public name shown on the Token Burn leaderboard.</p>
      </div>
      <form action={updateDisplayName} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="displayName">Display name</Label>
          <Input id="displayName" name="displayName" defaultValue={user.member.displayName} maxLength={32} required />
        </div>
        <Button type="submit">Save display name</Button>
      </form>
    </main>
  );
}
