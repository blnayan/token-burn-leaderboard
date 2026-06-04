// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
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

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("./setup-command-copy", () => ({
  SETUP_COMMAND: "npx @blnayan/token-burn@latest setup",
  SetupCommandCopy: () => <div>npx @blnayan/token-burn@latest setup</div>,
}));

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import SetupPage from "./page";

type AuthMockSession = {
  user?: {
    name?: string;
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
    findUnique: {
      mockReset: () => void;
      mockResolvedValue: (value: { member: { displayName: string } | null } | null) => void;
    };
  };
};

async function renderSetupPage() {
  render(await SetupPage());
}

describe("SetupPage", () => {
  beforeEach(() => {
    authMock.mockReset();
    prismaMock.user.findUnique.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders setup steps for accepted members", async () => {
    authMock.mockResolvedValue({
      user: {
        githubId: "github-1",
        githubLogin: "member-user",
      },
      expires: "2026-06-04T00:00:00.000Z",
    });
    prismaMock.user.findUnique.mockResolvedValue({
      member: {
        displayName: "Ada",
      },
    });

    await renderSetupPage();

    expect(screen.getByRole("heading", { name: "Finish Token Burn Setup" })).toBeTruthy();
    expect(screen.getByText("npx @blnayan/token-burn@latest setup")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit display name" }).getAttribute("href")).toBe(
      "/settings/display-name",
    );
    expect(screen.getByRole("link", { name: "Go to leaderboard" }).getAttribute("href")).toBe("/");
    expect(screen.getByTestId("app-nav")).toBeTruthy();
  });

  it("shows sign-in guidance for signed-out visitors", async () => {
    authMock.mockResolvedValue(null);

    await renderSetupPage();

    expect(screen.getByRole("heading", { name: "Finish Token Burn Setup" })).toBeTruthy();
    expect(screen.getByText("Sign in with GitHub to continue setup.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeTruthy();
  });

  it("shows invite-required guidance for signed-in users without a member record", async () => {
    authMock.mockResolvedValue({
      user: {
        githubId: "github-1",
        githubLogin: "wrong-user",
      },
      expires: "2026-06-04T00:00:00.000Z",
    });
    prismaMock.user.findUnique.mockResolvedValue({
      member: null,
    });

    await renderSetupPage();

    expect(screen.getByRole("heading", { name: "Invite Required" })).toBeTruthy();
    expect(screen.getByText("Accept an invite before setting up Token Burn sync.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to leaderboard" }).getAttribute("href")).toBe("/");
    expect(screen.getByTestId("app-nav")).toBeTruthy();
  });
});
