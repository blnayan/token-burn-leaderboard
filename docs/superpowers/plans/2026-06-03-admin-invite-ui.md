# Admin Invite UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only invite entry point on the leaderboard and a copy button for generated invite links.

**Architecture:** Keep admin authorization on the server by deriving the homepage invite button from the existing NextAuth session and configured admin login. Add a small client component for copy-to-clipboard behavior so the existing admin invites server page can keep creating and validating invite URLs.

**Tech Stack:** Next.js App Router, React 19, Vitest, Testing Library, existing shadcn-style `Button`, `Input`, and `Label` components.

---

## File Structure

- Create `apps/web/src/server/admin.ts`: reusable admin-session predicate.
- Create `apps/web/src/server/admin.test.ts`: unit tests for admin predicate.
- Create `apps/web/src/app/admin/invites/invite-url-copy.tsx`: client component for invite URL display and copy behavior.
- Create `apps/web/src/app/admin/invites/invite-url-copy.test.tsx`: jsdom tests for copy behavior.
- Modify `apps/web/src/app/admin/invites/page.tsx`: replace inline URL input with the copy component.
- Modify `apps/web/src/app/page.tsx`: render admin-only invite link button.
- Create `apps/web/src/app/page.test.tsx`: tests for homepage admin invite button rendering.
- Modify `apps/web/package.json` and `pnpm-lock.yaml`: add test-only dependencies for React component tests.

## Task 1: Add Client Component Test Support

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add web test dependencies**

Run:

```bash
pnpm --filter @token-burn/web add -D @testing-library/react @testing-library/user-event jsdom
```

Expected: command exits with status `0`, `apps/web/package.json` gains the three dev dependencies, and `pnpm-lock.yaml` updates.

- [ ] **Step 2: Commit dependency update**

Run:

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "test: add web component test utilities"
```

Expected: commit succeeds.

## Task 2: Add Admin Predicate

**Files:**
- Create: `apps/web/src/server/admin.ts`
- Create: `apps/web/src/server/admin.test.ts`

- [ ] **Step 1: Write admin predicate tests**

Create `apps/web/src/server/admin.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { isAdminGithubLogin, isAdminSessionUser } from "./admin";

describe("isAdminGithubLogin", () => {
  it("returns true only for the configured admin login", () => {
    expect(isAdminGithubLogin("blnayan", "blnayan")).toBe(true);
    expect(isAdminGithubLogin("someone-else", "blnayan")).toBe(false);
  });

  it("returns false for missing logins", () => {
    expect(isAdminGithubLogin(undefined, "blnayan")).toBe(false);
    expect(isAdminGithubLogin(null, "blnayan")).toBe(false);
    expect(isAdminGithubLogin("", "blnayan")).toBe(false);
  });
});

describe("isAdminSessionUser", () => {
  it("checks a session user githubLogin", () => {
    expect(isAdminSessionUser({ githubLogin: "blnayan" }, "blnayan")).toBe(true);
    expect(isAdminSessionUser({ githubLogin: "someone-else" }, "blnayan")).toBe(false);
  });

  it("returns false when the session user is missing", () => {
    expect(isAdminSessionUser(undefined, "blnayan")).toBe(false);
    expect(isAdminSessionUser(null, "blnayan")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/admin.test.ts
```

Expected: fails because `./admin` does not exist.

- [ ] **Step 3: Implement admin predicate**

Create `apps/web/src/server/admin.ts`:

```ts
type SessionUserWithGithubLogin = {
  githubLogin?: string | null;
};

export function isAdminGithubLogin(githubLogin: string | null | undefined, adminGithubLogin: string): boolean {
  return Boolean(githubLogin) && githubLogin === adminGithubLogin;
}

export function isAdminSessionUser(
  user: SessionUserWithGithubLogin | null | undefined,
  adminGithubLogin: string,
): boolean {
  return isAdminGithubLogin(user?.githubLogin, adminGithubLogin);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/admin.test.ts
```

Expected: `admin.test.ts` passes.

- [ ] **Step 5: Commit admin predicate**

Run:

```bash
git add apps/web/src/server/admin.ts apps/web/src/server/admin.test.ts
git commit -m "feat: add admin session predicate"
```

Expected: commit succeeds.

## Task 3: Add Invite URL Copy Component

**Files:**
- Create: `apps/web/src/app/admin/invites/invite-url-copy.tsx`
- Create: `apps/web/src/app/admin/invites/invite-url-copy.test.tsx`

- [ ] **Step 1: Write copy component tests**

Create `apps/web/src/app/admin/invites/invite-url-copy.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InviteUrlCopy, copyInviteUrl } from "./invite-url-copy";

const inviteUrl = "https://tokenburn.example.com/invite/abc123";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("copyInviteUrl", () => {
  it("writes the invite URL to the provided clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await copyInviteUrl(inviteUrl, { writeText });

    expect(writeText).toHaveBeenCalledWith(inviteUrl);
  });

  it("throws when clipboard writing is unavailable", async () => {
    await expect(copyInviteUrl(inviteUrl, undefined)).rejects.toThrow("Clipboard copy is unavailable");
  });
});

describe("InviteUrlCopy", () => {
  it("renders the invite URL in a read-only input", () => {
    render(<InviteUrlCopy inviteUrl={inviteUrl} />);

    const input = screen.getByLabelText("Invite URL");
    expect(input).toHaveProperty("value", inviteUrl);
    expect(input).toHaveProperty("readOnly", true);
  });

  it("copies the URL and shows copied state", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<InviteUrlCopy inviteUrl={inviteUrl} />);

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith(inviteUrl);
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    expect(screen.getByText("Invite link copied.")).toBeTruthy();
  });

  it("shows a failure message when clipboard copy fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    render(<InviteUrlCopy inviteUrl={inviteUrl} />);

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.getByText("Could not copy invite link. Select the URL manually.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @token-burn/web test -- src/app/admin/invites/invite-url-copy.test.tsx
```

Expected: fails because `./invite-url-copy` does not exist.

- [ ] **Step 3: Implement copy component**

Create `apps/web/src/app/admin/invites/invite-url-copy.tsx`:

```tsx
"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ClipboardWriter = {
  writeText: (text: string) => Promise<void>;
};

type CopyStatus = "idle" | "copied" | "failed";

export async function copyInviteUrl(
  inviteUrl: string,
  clipboard: ClipboardWriter | undefined = navigator.clipboard,
): Promise<void> {
  if (!clipboard?.writeText) {
    throw new Error("Clipboard copy is unavailable");
  }

  await clipboard.writeText(inviteUrl);
}

export function InviteUrlCopy({ inviteUrl }: { inviteUrl: string }) {
  const [status, setStatus] = useState<CopyStatus>("idle");

  async function handleCopy() {
    try {
      await copyInviteUrl(inviteUrl);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="inviteUrl">Invite URL</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="inviteUrl" value={inviteUrl} readOnly className="font-mono text-sm" />
        <Button type="button" onClick={handleCopy} className="sm:w-24">
          {status === "copied" ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
        {status === "copied" ? "Invite link copied." : null}
        {status === "failed" ? "Could not copy invite link. Select the URL manually." : null}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @token-burn/web test -- src/app/admin/invites/invite-url-copy.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Commit copy component**

Run:

```bash
git add apps/web/src/app/admin/invites/invite-url-copy.tsx apps/web/src/app/admin/invites/invite-url-copy.test.tsx
git commit -m "feat: add invite link copy control"
```

Expected: commit succeeds.

## Task 4: Wire Copy Component Into Admin Invites Page

**Files:**
- Modify: `apps/web/src/app/admin/invites/page.tsx`

- [ ] **Step 1: Update admin invites page**

Modify `apps/web/src/app/admin/invites/page.tsx`:

```diff
 import { redirect } from "next/navigation";
 
 import { auth, signIn } from "@/auth";
 import { Button } from "@/components/ui/button";
-import { Input } from "@/components/ui/input";
-import { Label } from "@/components/ui/label";
 import { env } from "@/lib/env";
 import { prisma } from "@/lib/prisma";
 import { createInviteCode, createInviteExpiration, hashInviteCode } from "@/server/invites";
+
+import { InviteUrlCopy } from "./invite-url-copy";
```

Replace the invite URL block:

```diff
       {inviteUrl ? (
-        <div className="flex flex-col gap-2">
-          <Label htmlFor="inviteUrl">Invite URL</Label>
-          <Input id="inviteUrl" value={inviteUrl} readOnly />
-        </div>
+        <InviteUrlCopy inviteUrl={inviteUrl} />
       ) : null}
```

- [ ] **Step 2: Run copy component tests**

Run:

```bash
pnpm --filter @token-burn/web test -- src/app/admin/invites/invite-url-copy.test.tsx
```

Expected: tests pass.

- [ ] **Step 3: Commit page integration**

Run:

```bash
git add apps/web/src/app/admin/invites/page.tsx
git commit -m "feat: show copy control for invite links"
```

Expected: commit succeeds.

## Task 5: Add Homepage Admin Invite Button

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/page.test.tsx`

- [ ] **Step 1: Write homepage tests**

Create `apps/web/src/app/page.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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

vi.mock("@/server/leaderboard", () => ({
  getLeaderboard: vi.fn().mockResolvedValue([]),
}));

import { auth } from "@/auth";

import HomePage from "./page";

const authMock = vi.mocked(auth);

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @token-burn/web test -- src/app/page.test.tsx
```

Expected: the admin test fails because the homepage does not render an invite link yet.

- [ ] **Step 3: Implement homepage invite button**

Modify `apps/web/src/app/page.tsx`:

```tsx
import { periodSchema, type LeaderboardPeriod } from "@token-burn/shared";
import Link from "next/link";

import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { PeriodTabs } from "@/components/period-tabs";
import { env } from "@/lib/env";
import { isAdminSessionUser } from "@/server/admin";
import { getLeaderboard } from "@/server/leaderboard";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const params = await searchParams;
  const period: LeaderboardPeriod = periodSchema.catch("daily").parse(params.period);
  const [rows, session] = await Promise.all([getLeaderboard(period), auth()]);
  const showInviteButton = isAdminSessionUser(session?.user, env.ADMIN_GITHUB_LOGIN);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-5 border-b pb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold">Token Burn</h1>
            <p className="text-sm text-muted-foreground">Public leaderboard. Private submissions.</p>
          </div>
          {showInviteButton ? (
            <Button asChild variant="outline" className="w-fit">
              <Link href="/admin/invites">Invite</Link>
            </Button>
          ) : null}
        </div>
        <PeriodTabs value={period} />
      </header>
      <LeaderboardTable rows={rows} />
    </main>
  );
}
```

- [ ] **Step 4: Run homepage tests**

Run:

```bash
pnpm --filter @token-burn/web test -- src/app/page.test.tsx
```

Expected: all homepage tests pass.

- [ ] **Step 5: Commit homepage button**

Run:

```bash
git add apps/web/src/app/page.tsx apps/web/src/app/page.test.tsx
git commit -m "feat: add admin invite button"
```

Expected: commit succeeds.

## Task 6: Final Verification

**Files:**
- Verify: `apps/web/src/app/page.tsx`
- Verify: `apps/web/src/app/admin/invites/page.tsx`
- Verify: `apps/web/src/app/admin/invites/invite-url-copy.tsx`
- Verify: `apps/web/src/server/admin.ts`

- [ ] **Step 1: Run focused web tests**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/admin.test.ts src/app/admin/invites/invite-url-copy.test.tsx src/app/page.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run full web tests**

Run:

```bash
pnpm --filter @token-burn/web test
```

Expected: all web tests pass.

- [ ] **Step 3: Run web typecheck**

Run:

```bash
DATABASE_URL=postgresql://tokenburn:change-this-password@localhost:5432/tokenburn pnpm --filter @token-burn/web db:generate
DATABASE_URL=postgresql://tokenburn:change-this-password@localhost:5432/tokenburn pnpm --filter @token-burn/web typecheck
```

Expected: Prisma generate and typecheck pass.

- [ ] **Step 4: Run web build**

Run:

```bash
ADMIN_GITHUB_LOGIN=build-admin AUTH_GITHUB_ID=build-github-id AUTH_GITHUB_SECRET=build-github-secret AUTH_SECRET=build-auth-secret AUTH_URL=http://127.0.0.1:3000 DATABASE_URL=postgresql://tokenburn:change-this-password@localhost:5432/tokenburn TOKEN_BURN_PUBLIC_URL=http://127.0.0.1:3000 pnpm --filter @token-burn/web build
```

Expected: production build passes.

- [ ] **Step 5: Commit verification fixes if needed**

If verification required fixes, run:

```bash
git add apps/web apps/web/package.json pnpm-lock.yaml
git commit -m "fix: stabilize admin invite ui"
```

Expected: commit succeeds only if fixes were made.

- [ ] **Step 6: Final status**

Run:

```bash
git status --short
```

Expected: no output.
