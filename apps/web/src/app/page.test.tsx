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
  Button: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/server/leaderboard", () => ({
  getLeaderboard: vi.fn().mockResolvedValue([]),
}));

import { auth } from "@/auth";

import HomePage from "./page";

type AuthMockSession = {
  user?: {
    githubLogin?: string;
  };
  expires: string;
} | null;

const authMock = auth as unknown as {
  mockReset: () => void;
  mockResolvedValue: (value: AuthMockSession) => void;
};

async function renderHomePage() {
  render(await HomePage({ searchParams: Promise.resolve({}) }));
}

describe("HomePage admin invite button", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders an invite link for the configured admin", async () => {
    authMock.mockResolvedValue({
      user: {
        githubLogin: "admin-user",
      },
      expires: "2026-06-03T00:00:00.000Z",
    });

    await renderHomePage();

    const inviteLink = screen.getByRole("link", { name: "Invite" });
    expect(inviteLink.getAttribute("href")).toBe("/admin/invites");
  });

  it("does not render an invite link for a non-admin user", async () => {
    authMock.mockResolvedValue({
      user: {
        githubLogin: "member-user",
      },
      expires: "2026-06-03T00:00:00.000Z",
    });

    await renderHomePage();

    expect(screen.queryByRole("link", { name: "Invite" })).toBeNull();
  });

  it("does not render an invite link for signed-out users", async () => {
    authMock.mockResolvedValue(null);

    await renderHomePage();

    expect(screen.queryByRole("link", { name: "Invite" })).toBeNull();
  });
});
