// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/components/session-controls", () => ({
  SessionControls: () => <div data-testid="session-controls" />,
  SignInWithGitHubButton: () => <button>Sign in with GitHub</button>,
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
    TOKEN_BURN_PUBLIC_URL: "https://tokenburn.example.com",
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cliLoginSession: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import CliApprovePage from "./page";

const authMock = auth as unknown as {
  mockReset: () => void;
  mockResolvedValue: (value: { user: { githubId: string }; expires: string }) => void;
};

const prismaMock = prisma as unknown as {
  cliLoginSession: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  user: {
    findUnique: ReturnType<typeof vi.fn>;
  };
};

async function renderCliApprovePage(searchParams: { approved?: string } = {}) {
  render(
    await CliApprovePage({
      params: Promise.resolve({ code: "abc123" }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

describe("CliApprovePage", () => {
  beforeEach(() => {
    authMock.mockReset();
    prismaMock.cliLoginSession.findUnique.mockReset();
    prismaMock.user.findUnique.mockReset();

    authMock.mockResolvedValue({
      user: {
        githubId: "github-1",
      },
      expires: "2026-06-04T00:00:00.000Z",
    });
    prismaMock.cliLoginSession.findUnique.mockResolvedValue({
      approvedAt: new Date("2026-06-04T00:00:00.000Z"),
      expiresAt: new Date("2999-01-01T00:00:00.000Z"),
      memberId: "member-1",
    });
    prismaMock.user.findUnique.mockResolvedValue({
      member: {
        displayName: "Ada",
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a leaderboard button after approving CLI login", async () => {
    await renderCliApprovePage({ approved: "1" });

    expect(screen.getByText("CLI login approved. You can return to your terminal.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to leaderboard" }).getAttribute("href")).toBe(
      "https://tokenburn.example.com",
    );
    expect(screen.queryByRole("button", { name: "Approve CLI login" })).toBeNull();
  });
});
