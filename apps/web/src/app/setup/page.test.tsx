// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

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

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <section role="dialog">{children}</section>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogTrigger: ({
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
    member: {
      update: vi.fn(),
    },
  },
}));

vi.mock("./setup-command-copy", () => ({
  SETUP_COMMAND: "npx @blnayan/token-burn@latest setup",
  SetupCommandCopy: () => <div>npx @blnayan/token-burn@latest setup</div>,
}));

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

import SetupPage, { updateDisplayName } from "./page";

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
      mockResolvedValue: (
        value:
          | { member: { id?: string; displayName: string } | null }
          | null,
      ) => void;
    };
  };
  member: {
    update: ReturnType<typeof vi.fn>;
  };
};

const redirectMock = redirect as unknown as {
  mockReset: () => void;
  mockImplementation: (implementation: (url: string) => never) => void;
  mock: { calls: Array<[string]> };
};

async function renderSetupPage() {
  render(await SetupPage());
}

describe("SetupPage", () => {
  beforeEach(() => {
    authMock.mockReset();
    prismaMock.user.findUnique.mockReset();
    prismaMock.member.update.mockReset();
    redirectMock.mockReset();
    redirectMock.mockImplementation((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    });
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
        id: "member-1",
        displayName: "Ada",
      },
    });

    await renderSetupPage();

    expect(screen.getByRole("heading", { name: "Finish Token Burn Setup" })).toBeTruthy();
    expect(screen.getByText("npx @blnayan/token-burn@latest setup")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit display name" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Edit display name" })).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Edit display name" })).toBeTruthy();
    expect(screen.getByLabelText("Display name")).toHaveProperty("value", "Ada");
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

  it("saves display name changes and returns to setup", async () => {
    authMock.mockResolvedValue({
      user: {
        githubId: "github-1",
        githubLogin: "member-user",
      },
      expires: "2026-06-04T00:00:00.000Z",
    });
    prismaMock.user.findUnique.mockResolvedValue({
      member: {
        id: "member-1",
        displayName: "Ada",
      },
    });
    prismaMock.member.update.mockResolvedValue({});

    const formData = new FormData();
    formData.set("displayName", "Grace Hopper");

    let redirectError: unknown;
    try {
      await updateDisplayName({ message: null }, formData);
    } catch (error) {
      redirectError = error;
    }

    expect(prismaMock.member.update).toHaveBeenCalledWith({
      where: { id: "member-1" },
      data: { displayName: "Grace Hopper" },
    });
    expect(() => {
      throw redirectError;
    }).toThrow("NEXT_REDIRECT:/setup");
    expect(redirectMock.mock.calls.at(-1)).toEqual(["/setup"]);
  });
});
