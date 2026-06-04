// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/components/app-nav", () => ({
  AppNav: vi.fn().mockResolvedValue(<nav data-testid="app-nav" />),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    asChild,
    children,
    ...props
  }: {
    asChild?: boolean;
    children: ReactNode;
    [key: string]: unknown;
  }) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children as ReactElement<Record<string, unknown>>, props);
    }

    return <button {...props}>{children}</button>;
  },
}));

vi.mock("@/lib/env", () => ({
  env: {
    ADMIN_GITHUB_LOGIN: "admin-user",
    TOKEN_BURN_PUBLIC_URL: "https://tokenburn.example.com",
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    invite: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import AdminInvitesPage from "./page";

type AuthMockSession = {
  user?: {
    githubId?: string;
    githubLogin?: string;
  };
  expires: string;
} | null;

const authMock = auth as unknown as {
  mockReset: () => void;
  mockResolvedValue: (value: AuthMockSession) => void;
};

const prismaMock = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  invite: {
    findFirst: ReturnType<typeof vi.fn>;
  };
};

async function renderAdminInvitesPage(code?: string) {
  render(await AdminInvitesPage({ searchParams: Promise.resolve(code ? { code } : {}) }));
}

describe("AdminInvitesPage", () => {
  beforeEach(() => {
    authMock.mockReset();
    prismaMock.user.findUnique.mockReset();
    prismaMock.invite.findFirst.mockReset();
    prismaMock.invite.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders GitHub sign-in for signed-out visitors", async () => {
    authMock.mockResolvedValue(null);

    await renderAdminInvitesPage();

    expect(screen.getByRole("heading", { name: "Invites" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeTruthy();
    expect(screen.getByTestId("app-nav")).toBeTruthy();
  });

  it("lets signed-in non-admin users sign out and switch accounts", async () => {
    authMock.mockResolvedValue({
      user: {
        githubId: "github-1",
        githubLogin: "wrong-user",
      },
      expires: "2026-06-04T00:00:00.000Z",
    });
    prismaMock.user.findUnique.mockResolvedValue({
      githubLogin: "wrong-user",
    });

    await renderAdminInvitesPage();

    expect(screen.getByRole("heading", { name: "Admin Required" })).toBeTruthy();
    expect(screen.getByText("Only the configured admin can create invites.")).toBeTruthy();
    expect(screen.getByTestId("app-nav")).toBeTruthy();
  });

  it("lets the configured admin create invites and sign out", async () => {
    authMock.mockResolvedValue({
      user: {
        githubId: "github-admin",
        githubLogin: "admin-user",
      },
      expires: "2026-06-04T00:00:00.000Z",
    });
    prismaMock.user.findUnique.mockResolvedValue({
      githubLogin: "admin-user",
    });

    await renderAdminInvitesPage();

    expect(screen.getByRole("heading", { name: "Invites" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create invite" })).toBeTruthy();
    expect(screen.getByTestId("app-nav")).toBeTruthy();
  });
});
