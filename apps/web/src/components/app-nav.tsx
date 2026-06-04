/** @jsxRuntime automatic */
import type { Session } from "next-auth";
import Link from "next/link";

import { AppNavLink } from "@/components/app-nav-link";
import { SessionControls } from "@/components/session-controls";
import { NavigationMenu, NavigationMenuList } from "@/components/ui/navigation-menu";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { isAdminGithubLogin } from "@/server/admin";

type AppNavProps = {
  session: Session | null;
  currentPath?: string;
};

export async function AppNav({ session, currentPath = "/" }: AppNavProps) {
  const user = session?.user?.githubId
    ? await prisma.user.findUnique({
        where: { githubId: session.user.githubId },
        select: {
          githubLogin: true,
          member: { select: { id: true } },
        },
      })
    : null;
  const githubLogin = user?.githubLogin ?? session?.user?.githubLogin;
  const isMember = Boolean(user?.member);
  const isAdmin = isAdminGithubLogin(githubLogin, env.ADMIN_GITHUB_LOGIN);
  const navSession =
    session?.user && githubLogin ? { ...session, user: { ...session.user, githubLogin } } : session;

  return (
    <header className="border-b bg-background" data-testid="app-nav">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link className="text-base font-semibold" href="/">
            Token Burn
          </Link>
          <NavigationMenu>
            <NavigationMenuList className="flex-wrap justify-start gap-1">
              <AppNavLink currentPath={currentPath} href="/setup">
                Setup
              </AppNavLink>
              {isMember ? (
                <AppNavLink currentPath={currentPath} href="/settings/display-name">
                  Display name
                </AppNavLink>
              ) : null}
              {isAdmin ? (
                <AppNavLink currentPath={currentPath} href="/admin/invites">
                  Invites
                </AppNavLink>
              ) : null}
            </NavigationMenuList>
          </NavigationMenu>
        </div>
        <SessionControls session={navSession} redirectTo={currentPath} layout="inline" />
      </div>
    </header>
  );
}
