/** @jsxRuntime automatic */
import type { Session } from "next-auth";

import { signIn, signOut } from "@/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

function getAccountInitials(user: SessionUser): string {
  const label = user.name ?? user.githubLogin ?? "GitHub";
  const words = label
    .replace(/^@/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);

  if (words.length >= 2) {
    return words
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase();
  }

  return label.replace(/^@/, "").slice(0, 2).toUpperCase() || "GH";
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

function SignOutMenuItem({ redirectTo = "/" }: { redirectTo?: string }) {
  return (
    <form action={signOutTo.bind(null, { redirectTo })}>
      <DropdownMenuItem asChild>
        <button type="submit" className="w-full">
          Sign out
        </button>
      </DropdownMenuItem>
    </form>
  );
}

function AccountMenu({ redirectTo, user }: { redirectTo: string; user: SessionUser }) {
  const accountLabel = getAccountLabel(user);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Open account menu for ${accountLabel}`}
          className="rounded-full"
          size="icon"
          type="button"
          variant="ghost"
        >
          <Avatar className="size-8">
            {user.image ? <AvatarImage alt={accountLabel} src={user.image} /> : null}
            <AvatarFallback className="text-xs">{getAccountInitials(user)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-1">
            <span className="text-xs font-normal text-muted-foreground">Signed in as</span>
            <span className="truncate">{accountLabel}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <SignOutMenuItem redirectTo={redirectTo} />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SessionControls({
  session,
  redirectTo = "/",
}: {
  session: Session | null;
  redirectTo?: string;
}) {
  if (!session?.user) return <SignInWithGitHubButton redirectTo={redirectTo} />;

  return <AccountMenu redirectTo={redirectTo} user={session.user} />;
}
