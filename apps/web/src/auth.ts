import type { DefaultSession } from "next-auth";
import NextAuth from "next-auth";
import GitHub, { type GitHubProfile } from "next-auth/providers/github";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

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

      await prisma.user.upsert({
        where: { githubId: String(githubProfile.id) },
        create: {
          githubId: String(githubProfile.id),
          githubLogin: githubProfile.login,
        },
        update: {
          githubLogin: githubProfile.login,
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
