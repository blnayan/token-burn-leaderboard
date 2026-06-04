/** @jsxRuntime automatic */
import type { Session } from "next-auth";

import { signIn, signOut } from "@/auth";
import { Button } from "@/components/ui/button";

type SessionUser = NonNullable<Session["user"]>;

async function signInWithGitHub({ redirectTo }: { redirectTo: string }) {
  "use server";

  await signIn("github", { redirectTo });
}

async function signOutTo({ redirectTo }: { redirectTo: string }) {
  "use server";

  await signOut({ redirectTo });
}

function getAccountLabel(user: SessionUser): string {
  if (user.githubLogin) return `@${user.githubLogin}`;
  if (user.name) return user.name;
  return "GitHub";
}

export function SignInWithGitHubButton({ redirectTo }: { redirectTo: string }) {
  return (
    <form action={signInWithGitHub.bind(null, { redirectTo })}>
      <Button type="submit">Sign in with GitHub</Button>
    </form>
  );
}

export function SignOutButton({ redirectTo = "/" }: { redirectTo?: string }) {
  return (
    <form action={signOutTo.bind(null, { redirectTo })}>
      <Button type="submit" variant="outline">
        Sign out
      </Button>
    </form>
  );
}

export function SessionControls({
  session,
  redirectTo = "/",
  layout = "stack",
}: {
  session: Session | null;
  redirectTo?: string;
  layout?: "stack" | "inline";
}) {
  if (!session?.user) return <SignInWithGitHubButton redirectTo={redirectTo} />;

  const className =
    layout === "inline" ? "flex flex-wrap items-center gap-3" : "flex flex-col items-start gap-2";

  return (
    <div className={className} data-testid="session-controls">
      <p className="text-sm text-muted-foreground">Signed in as {getAccountLabel(session.user)}</p>
      <SignOutButton redirectTo={redirectTo} />
    </div>
  );
}
