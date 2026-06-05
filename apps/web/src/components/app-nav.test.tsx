// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  signIn: vi.fn(),
  signOut: vi.fn(),
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

vi.mock("@/components/ui/navigation-menu", () => ({
  NavigationMenu: ({ children }: { children: ReactNode }) => <nav aria-label="Primary">{children}</nav>,
  NavigationMenuItem: ({ children }: { children: ReactNode }) => <li>{children}</li>,
  NavigationMenuLink: ({
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

    return <a {...props}>{children}</a>;
  },
  NavigationMenuList: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
  navigationMenuTriggerStyle: () => "nav-link",
}));

vi.mock("@/lib/env", () => ({
  env: {
    ADMIN_GITHUB_LOGIN: "admin-user",
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

import { AppNav } from "./app-nav";

type Session = {
  user?: {
    githubId?: string;
    githubLogin?: string;
    image?: string;
    name?: string;
  };
  expires: string;
} | null;

const prismaMock = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
  };
};

async function renderAppNav(session: Session) {
  render(await AppNav({ session }));
}

describe("AppNav", () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows public navigation and sign-in for signed-out users", async () => {
    await renderAppNav(null);

    expect(screen.getByRole("link", { name: "Token Burn" }).getAttribute("href")).toBe("/");
    expect(screen.queryByRole("link", { name: "Leaderboard" })).toBeNull();
    expect(screen.getByRole("link", { name: "Setup" }).getAttribute("href")).toBe("/setup");
    expect(screen.queryByRole("link", { name: "Display name" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Invites" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeTruthy();
  });

  it("shows a compact profile menu for members", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      githubLogin: "member-user",
      member: { id: "member-1" },
    });

    const user = userEvent.setup();

    await renderAppNav({
      user: {
        githubId: "github-1",
        githubLogin: "member-user",
        image: "https://example.com/member.png",
        name: "Member User",
      },
      expires: "2026-06-04T00:00:00.000Z",
    });

    expect(screen.queryByRole("link", { name: "Display name" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Invites" })).toBeNull();
    expect(screen.queryByText("Signed in as")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open account menu for @member-user" }));

    expect(screen.getByText("Signed in as")).toBeTruthy();
    expect(screen.getByText("@member-user")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
  });

  it("shows admin navigation for the configured admin", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      githubLogin: "admin-user",
      member: { id: "member-1" },
    });

    await renderAppNav({
      user: {
        githubId: "github-admin",
        githubLogin: "admin-user",
      },
      expires: "2026-06-04T00:00:00.000Z",
    });

    expect(screen.getByRole("link", { name: "Invites" }).getAttribute("href")).toBe("/admin/invites");
  });
});
