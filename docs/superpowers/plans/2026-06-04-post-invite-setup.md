# Post-Invite Setup Instructions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redirect accepted invite users to a setup page that explains display-name setup, CLI setup, automatic sync, and provides a leaderboard button.

**Architecture:** Add a focused `/setup` server page that owns post-invite onboarding instructions and access handling. Keep invite redemption logic unchanged except for the successful redirect target. Use direct Vitest page tests with mocks, matching the existing app test style.

**Tech Stack:** Next.js App Router, React 19, TypeScript, NextAuth helpers, Prisma client, Vitest, Testing Library.

---

## File Structure

- Create `apps/web/src/app/setup/page.tsx`: server page for post-invite setup instructions and access states.
- Create `apps/web/src/app/setup/page.test.tsx`: jsdom tests for member, signed-out, and signed-in non-member setup page states.
- Modify `apps/web/src/app/invite/[code]/page.tsx`: export `acceptInvite` for focused testing and redirect successful invite acceptance to `/setup`.
- Create `apps/web/src/app/invite/[code]/page.test.tsx`: server-action test that verifies successful invite redemption redirects to `/setup`.

## Task 1: Setup Page Tests

**Files:**
- Create: `apps/web/src/app/setup/page.test.tsx`
- Later implementation: `apps/web/src/app/setup/page.tsx`

- [ ] **Step 1: Create the failing setup page tests**

Create `apps/web/src/app/setup/page.test.tsx`:

```tsx
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

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import SetupPage from "./page";

type AuthMockSession = {
  user?: {
    githubId?: string;
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
  });
});
```

- [ ] **Step 2: Run setup page tests to verify they fail**

Run:

```bash
pnpm --filter @token-burn/web test -- src/app/setup/page.test.tsx
```

Expected: FAIL because `apps/web/src/app/setup/page.tsx` does not exist.

## Task 2: Setup Page Implementation

**Files:**
- Create: `apps/web/src/app/setup/page.tsx`
- Test: `apps/web/src/app/setup/page.test.tsx`

- [ ] **Step 1: Create the setup page**

Create `apps/web/src/app/setup/page.tsx`:

```tsx
import Link from "next/link";

import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";

async function signInWithGitHub() {
  "use server";

  await signIn("github", { redirectTo: "/setup" });
}

export default async function SetupPage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold">Finish Token Burn Setup</h1>
          <p className="text-sm text-muted-foreground">Sign in with GitHub to continue setup.</p>
        </div>
        <form action={signInWithGitHub}>
          <Button type="submit">Sign in with GitHub</Button>
        </form>
      </main>
    );
  }

  const githubId = session.user.githubId;
  const user = githubId
    ? await prisma.user.findUnique({
        where: { githubId },
        select: { member: { select: { displayName: true } } },
      })
    : null;

  if (!user?.member) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-5 py-8">
        <h1 className="text-3xl font-semibold">Invite Required</h1>
        <p className="text-sm text-muted-foreground">Accept an invite before setting up Token Burn sync.</p>
        <Button asChild className="w-fit">
          <Link href="/">Go to leaderboard</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-6 px-5 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Finish Token Burn Setup</h1>
        <p className="text-sm text-muted-foreground">
          Your invite is accepted. Finish these steps to start syncing usage to the leaderboard.
        </p>
      </div>

      <ol className="flex flex-col gap-4">
        <li className="rounded-md border px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-medium">1. Set your display name</h2>
              <p className="text-sm text-muted-foreground">
                You are currently shown as {user.member.displayName}.
              </p>
            </div>
            <Button asChild variant="outline" className="w-fit">
              <Link href="/settings/display-name">Edit display name</Link>
            </Button>
          </div>
        </li>

        <li className="rounded-md border px-4 py-3">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-medium">2. Run CLI setup</h2>
              <p className="text-sm text-muted-foreground">
                Open a terminal on the device you want to track and run this command.
              </p>
            </div>
            <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-sm">
              <code>npx @blnayan/token-burn@latest setup</code>
            </pre>
          </div>
        </li>

        <li className="rounded-md border px-4 py-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-medium">3. Finish the terminal prompts</h2>
            <p className="text-sm text-muted-foreground">
              Setup signs in, runs the first sync, and installs automatic sync every 15 minutes.
            </p>
          </div>
        </li>
      </ol>

      <Button asChild className="w-fit">
        <Link href="/">Go to leaderboard</Link>
      </Button>
    </main>
  );
}
```

- [ ] **Step 2: Run setup page tests to verify they pass**

Run:

```bash
pnpm --filter @token-burn/web test -- src/app/setup/page.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit setup page**

Run:

```bash
git add apps/web/src/app/setup/page.tsx apps/web/src/app/setup/page.test.tsx
git commit -m "feat: add post-invite setup page"
```

Expected: commit succeeds.

## Task 3: Invite Redirect Tests

**Files:**
- Create: `apps/web/src/app/invite/[code]/page.test.tsx`
- Modify later: `apps/web/src/app/invite/[code]/page.tsx`

- [ ] **Step 1: Create the failing invite redirect test**

Create `apps/web/src/app/invite/[code]/page.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/env", () => ({
  env: {
    TOKEN_BURN_PUBLIC_URL: "https://tokenburn.example.com",
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    invite: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    member: {
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import { acceptInvite } from "./page";

const authMock = auth as unknown as {
  mockReset: () => void;
  mockResolvedValue: (value: { user: { githubId: string }; expires: string }) => void;
};

const redirectMock = redirect as unknown as {
  mockReset: () => void;
  mockImplementation: (implementation: (url: string) => never) => void;
  mock: { calls: Array<[string]> };
};

type MockFn = {
  mockReset: () => void;
  mockResolvedValue: (value: unknown) => void;
};

type TransactionClientMock = {
  member: {
    upsert: MockFn;
  };
  invite: {
    updateMany: MockFn;
  };
};

type TransactionMockFn = {
  mockReset: () => void;
  mockImplementation: (implementation: (callback: (tx: TransactionClientMock) => Promise<void>) => Promise<void>) => void;
};

const prismaMock = prisma as unknown as {
  user: {
    findUnique: MockFn;
  };
  invite: {
    findUnique: MockFn;
    updateMany: MockFn;
  };
  member: {
    upsert: MockFn;
  };
  $transaction: TransactionMockFn;
};

describe("acceptInvite", () => {
  beforeEach(() => {
    authMock.mockReset();
    redirectMock.mockReset();
    redirectMock.mockImplementation((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    });
    prismaMock.user.findUnique.mockReset();
    prismaMock.invite.findUnique.mockReset();
    prismaMock.invite.updateMany.mockReset();
    prismaMock.member.upsert.mockReset();
    prismaMock.$transaction.mockReset();

    authMock.mockResolvedValue({
      user: {
        githubId: "github-1",
      },
      expires: "2026-06-04T00:00:00.000Z",
    });
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1" });
    prismaMock.invite.findUnique.mockResolvedValue({
      id: "invite-1",
      redeemedAt: null,
      expiresAt: new Date("2999-01-01T00:00:00.000Z"),
    });
    prismaMock.member.upsert.mockResolvedValue({});
    prismaMock.invite.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.$transaction.mockImplementation(async (callback) => {
      await callback({
        member: prismaMock.member,
        invite: prismaMock.invite,
      });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("redirects accepted invites to setup instructions", async () => {
    const formData = new FormData();
    formData.set("code", "abc123");

    await expect(acceptInvite(formData)).rejects.toThrow("NEXT_REDIRECT:/setup");

    expect(redirectMock.mock.calls.at(-1)).toEqual(["/setup"]);
  });
});
```

- [ ] **Step 2: Run invite redirect test to verify it fails**

Run:

```bash
pnpm --filter @token-burn/web test -- 'src/app/invite/[code]/page.test.tsx'
```

Expected: FAIL because `acceptInvite` is not exported or because it still redirects to `/settings/display-name`.

## Task 4: Invite Redirect Implementation

**Files:**
- Modify: `apps/web/src/app/invite/[code]/page.tsx`
- Test: `apps/web/src/app/invite/[code]/page.test.tsx`

- [ ] **Step 1: Export the server action and change the success redirect**

Modify `apps/web/src/app/invite/[code]/page.tsx`.

Change:

```tsx
async function acceptInvite(formData: FormData) {
```

to:

```tsx
export async function acceptInvite(formData: FormData) {
```

Change the successful redirect at the end of the action from:

```tsx
redirect("/settings/display-name");
```

to:

```tsx
redirect("/setup");
```

- [ ] **Step 2: Run invite redirect test to verify it passes**

Run:

```bash
pnpm --filter @token-burn/web test -- 'src/app/invite/[code]/page.test.tsx'
```

Expected: PASS.

- [ ] **Step 3: Run related web tests**

Run:

```bash
pnpm --filter @token-burn/web test -- src/app/setup/page.test.tsx 'src/app/invite/[code]/page.test.tsx' src/app/page.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit invite redirect**

Run:

```bash
git add 'apps/web/src/app/invite/[code]/page.tsx' 'apps/web/src/app/invite/[code]/page.test.tsx'
git commit -m "feat: redirect accepted invites to setup"
```

Expected: commit succeeds.

## Task 5: Full Verification

**Files:**
- Verify repository state after tasks 1-4.

- [ ] **Step 1: Run web tests**

Run:

```bash
pnpm --filter @token-burn/web test
```

Expected: PASS.

- [ ] **Step 2: Run web typecheck**

Run:

```bash
pnpm --filter @token-burn/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Run web lint**

Run:

```bash
pnpm --filter @token-burn/web lint
```

Expected: PASS.

- [ ] **Step 4: Run web build**

Run:

```bash
pnpm --filter @token-burn/web build
```

Expected: PASS.

- [ ] **Step 5: Check worktree**

Run:

```bash
git status --short
```

Expected: clean working tree.

## Self-Review

- Spec coverage: The plan covers the `/setup` page, display-name link, CLI command, leaderboard button, signed-out state, non-member state, and accepted-invite redirect.
- Placeholder scan: No placeholders, deferred implementation notes, or unspecified error-handling steps remain.
- Type consistency: Tests and implementation use the same page path, command text, link labels, and redirect path.
