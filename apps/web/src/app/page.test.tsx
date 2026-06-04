// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
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

vi.mock("@/lib/env", () => ({
  env: {
    ADMIN_GITHUB_LOGIN: "admin-user",
    AUTH_GITHUB_ID: "test-github-id",
    AUTH_GITHUB_SECRET: "test-github-secret",
    AUTH_SECRET: "test-auth-secret",
    AUTH_URL: "http://127.0.0.1:3000",
    DATABASE_URL: "postgresql://tokenburn:tokenburn@127.0.0.1:5432/tokenburn",
    TOKEN_BURN_PUBLIC_URL: "https://tokenburn.example.com",
  },
}));

vi.mock("@/components/leaderboard-table", () => ({
  LeaderboardTable: () => <div data-testid="leaderboard-table" />,
}));

vi.mock("@/components/period-tabs", () => ({
  PeriodTabs: () => <div data-testid="period-tabs" />,
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
      return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, props);
    }

    return <button {...props}>{children}</button>;
  },
}));

vi.mock("@/server/leaderboard", () => ({
  getLeaderboard: vi.fn().mockResolvedValue([]),
}));

import { auth } from "@/auth";
import { AppNav } from "@/components/app-nav";

import HomePage from "./page";

type AuthMockSession = {
  user?: {
    name?: string;
    githubLogin?: string;
  };
  expires: string;
} | null;

const authMock = auth as unknown as {
  mockReset: () => void;
  mockResolvedValue: (value: AuthMockSession) => void;
};

const appNavMock = AppNav as unknown as {
  mockClear: () => void;
  mockResolvedValue: (value: ReactNode) => void;
  mock: { calls: Array<[unknown]> };
};

async function renderHomePage() {
  render(await HomePage({ searchParams: Promise.resolve({}) }));
}

describe("HomePage", () => {
  beforeEach(() => {
    authMock.mockReset();
    appNavMock.mockClear();
    appNavMock.mockResolvedValue(<nav data-testid="app-nav" />);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the leaderboard with app navigation", async () => {
    authMock.mockResolvedValue({
      user: {
        githubLogin: "admin-user",
      },
      expires: "2026-06-03T00:00:00.000Z",
    });

    await renderHomePage();

    expect(screen.getByTestId("app-nav")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Leaderboard" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Token Burn" })).toBeNull();
    expect(screen.queryByText("Public leaderboard. Private submissions.")).toBeNull();
    expect(screen.getByTestId("period-tabs")).toBeTruthy();
    expect(screen.getByTestId("leaderboard-table")).toBeTruthy();
    expect(screen.getByRole("link", { name: "GitHub" }).getAttribute("href")).toBe(
      "https://github.com/blnayan/token-burn-leaderboard",
    );
    expect(appNavMock.mock.calls.at(-1)?.[0]).toMatchObject({
      currentPath: "/",
      session: {
        user: {
          githubLogin: "admin-user",
        },
      },
    });
  });

  it("passes signed-out sessions to app navigation", async () => {
    authMock.mockResolvedValue(null);

    await renderHomePage();

    expect(screen.getByTestId("app-nav")).toBeTruthy();
    expect(appNavMock.mock.calls.at(-1)?.[0]).toMatchObject({
      currentPath: "/",
      session: null,
    });
  });

  it("keeps account controls out of the leaderboard header", async () => {
    authMock.mockResolvedValue({
      user: {
        githubLogin: "member-user",
      },
      expires: "2026-06-03T00:00:00.000Z",
    });

    await renderHomePage();

    const leaderboardHeader = screen.getByRole("banner");
    expect(leaderboardHeader.textContent).not.toContain("Signed in as @member-user");
    expect(leaderboardHeader.textContent).not.toContain("Sign out");
  });
});
