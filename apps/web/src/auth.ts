import type { DefaultSession } from "next-auth";
import NextAuth from "next-auth";
import GitHub, { type GitHubProfile } from "next-auth/providers/github";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createDefaultDisplayName } from "@/server/display-name";

declare module "next-auth" {
  interface Session {
    user?: DefaultSession["user"] & {
      githubId?: string;
      githubLogin?: string;
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      clientId: env.AUTH_GITHUB_ID,
      clientSecret: env.AUTH_GITHUB_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      const githubProfile = profile as GitHubProfile | undefined;
      if (!githubProfile?.id || !githubProfile.login) return false;
      const githubName = typeof githubProfile.name === "string" ? githubProfile.name : null;
      const githubId = String(githubProfile.id);
      const existingUser = await prisma.user.findUnique({
        where: { githubId },
        select: {
          id: true,
          githubLogin: true,
          githubName: true,
          member: {
            select: {
              displayName: true,
              username: true,
            },
          },
        },
      });

      const user = await prisma.user.upsert({
        where: { githubId },
        create: {
          githubId,
          githubLogin: githubProfile.login,
          githubName,
        },
        update: {
          githubLogin: githubProfile.login,
          githubName,
        },
      });

      const defaultDisplayName = createDefaultDisplayName({
        githubName,
        githubLogin: githubProfile.login,
      });
      const previousDefaultDisplayName = existingUser
        ? createDefaultDisplayName({
            githubName: existingUser.githubName,
            githubLogin: existingUser.githubLogin,
          })
        : null;
      const shouldRefreshDefaultDisplayName =
        existingUser?.member &&
        [previousDefaultDisplayName, existingUser.githubLogin, existingUser.member.username].includes(
          existingUser.member.displayName,
        );

      await prisma.member.updateMany({
        where: {
          userId: user.id,
        },
        data: {
          username: githubProfile.login,
          ...(shouldRefreshDefaultDisplayName ? { displayName: defaultDisplayName } : {}),
        },
      });

      return true;
    },
    async jwt({ token, profile }) {
      const githubProfile = profile as GitHubProfile | undefined;

      if (githubProfile?.id && githubProfile.login) {
        token.githubId = String(githubProfile.id);
        token.githubLogin = githubProfile.login;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.githubId = typeof token.githubId === "string" ? token.githubId : undefined;
        session.user.githubLogin = typeof token.githubLogin === "string" ? token.githubLogin : undefined;
      }

      return session;
    },
  },
});
