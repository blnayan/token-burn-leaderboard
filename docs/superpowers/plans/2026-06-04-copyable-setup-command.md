# Copyable Setup Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a copy button for the `npx @blnayan/token-burn@latest setup` command on the post-invite setup page.

**Architecture:** Follow the existing invite URL copy pattern with a small client component local to `apps/web/src/app/setup`. Keep the server setup page responsible for authentication/member gating, and delegate only clipboard UI state to the new client component.

**Tech Stack:** Next.js App Router, React 19, TypeScript, shadcn-style Button/Input/Label components, Vitest, Testing Library, user-event.

---

## File Structure

- Create `apps/web/src/app/setup/setup-command-copy.tsx`: client component and clipboard helper for the setup command.
- Create `apps/web/src/app/setup/setup-command-copy.test.tsx`: jsdom tests for helper behavior, render state, copy success, and copy failure.
- Modify `apps/web/src/app/setup/page.tsx`: replace the static command `<pre><code>` with `SetupCommandCopy`.
- Modify `apps/web/src/app/setup/page.test.tsx`: mock `SetupCommandCopy` so the async server page test still asserts the command renders.

## Task 1: Setup Command Copy Component Tests

**Files:**
- Create: `apps/web/src/app/setup/setup-command-copy.test.tsx`
- Later implementation: `apps/web/src/app/setup/setup-command-copy.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `apps/web/src/app/setup/setup-command-copy.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SETUP_COMMAND, SetupCommandCopy, copySetupCommand } from "./setup-command-copy";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("copySetupCommand", () => {
  it("writes the setup command to the provided clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await copySetupCommand({ writeText });

    expect(writeText).toHaveBeenCalledWith("npx @blnayan/token-burn@latest setup");
  });

  it("throws when clipboard writing is unavailable", async () => {
    await expect(copySetupCommand(undefined)).rejects.toThrow("Clipboard copy is unavailable");
  });
});

describe("SetupCommandCopy", () => {
  it("renders the setup command in a read-only field", () => {
    render(<SetupCommandCopy />);

    const input = screen.getByLabelText("CLI setup command");
    expect(input).toHaveProperty("value", SETUP_COMMAND);
    expect(input).toHaveProperty("readOnly", true);
  });

  it("copies the setup command and shows copied state", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<SetupCommandCopy />);

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith(SETUP_COMMAND);
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    expect(screen.getByText("Setup command copied.")).toBeTruthy();
  });

  it("shows a manual-copy message when clipboard copy fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    render(<SetupCommandCopy />);

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.getByText("Could not copy command. Select it manually.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter @token-burn/web test -- src/app/setup/setup-command-copy.test.tsx
```

Expected: FAIL because `./setup-command-copy` does not exist.

## Task 2: Setup Command Copy Component Implementation

**Files:**
- Create: `apps/web/src/app/setup/setup-command-copy.tsx`
- Test: `apps/web/src/app/setup/setup-command-copy.test.tsx`

- [ ] **Step 1: Create the client component**

Create `apps/web/src/app/setup/setup-command-copy.tsx`:

```tsx
"use client";

import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const SETUP_COMMAND = "npx @blnayan/token-burn@latest setup";

type ClipboardWriter = {
  writeText: (text: string) => Promise<void>;
};

type CopyStatus = "idle" | "copied" | "failed";

export async function copySetupCommand(
  clipboard: ClipboardWriter | undefined = navigator.clipboard,
): Promise<void> {
  if (!clipboard?.writeText) {
    throw new Error("Clipboard copy is unavailable");
  }

  await clipboard.writeText(SETUP_COMMAND);
}

export function SetupCommandCopy() {
  const [status, setStatus] = useState<CopyStatus>("idle");

  async function handleCopy() {
    try {
      await copySetupCommand();
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="setupCommand">CLI setup command</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="setupCommand" value={SETUP_COMMAND} readOnly className="font-mono text-sm" />
        <Button type="button" onClick={handleCopy} className="sm:w-24">
          {status === "copied" ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
        {status === "copied" ? "Setup command copied." : null}
        {status === "failed" ? "Could not copy command. Select it manually." : null}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Run component tests to verify they pass**

Run:

```bash
pnpm --filter @token-burn/web test -- src/app/setup/setup-command-copy.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit the component**

Run:

```bash
git add apps/web/src/app/setup/setup-command-copy.tsx apps/web/src/app/setup/setup-command-copy.test.tsx
git commit -m "feat: add setup command copy control"
```

Expected: commit succeeds.

## Task 3: Setup Page Integration

**Files:**
- Modify: `apps/web/src/app/setup/page.tsx`
- Modify: `apps/web/src/app/setup/page.test.tsx`
- Test: `apps/web/src/app/setup/page.test.tsx`

- [ ] **Step 1: Mock the setup command copy component in the page test**

In `apps/web/src/app/setup/page.test.tsx`, add this mock before importing `SetupPage`:

```tsx
vi.mock("./setup-command-copy", () => ({
  SETUP_COMMAND: "npx @blnayan/token-burn@latest setup",
  SetupCommandCopy: () => <div>npx @blnayan/token-burn@latest setup</div>,
}));
```

Keep the existing accepted-member assertion:

```tsx
expect(screen.getByText("npx @blnayan/token-burn@latest setup")).toBeTruthy();
```

- [ ] **Step 2: Replace the static code block with the client component**

In `apps/web/src/app/setup/page.tsx`, add:

```tsx
import { SetupCommandCopy } from "./setup-command-copy";
```

Replace:

```tsx
<pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-sm">
  <code>npx @blnayan/token-burn@latest setup</code>
</pre>
```

with:

```tsx
<SetupCommandCopy />
```

- [ ] **Step 3: Run the setup page test**

Run:

```bash
pnpm --filter @token-burn/web test -- src/app/setup/page.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run related setup tests**

Run:

```bash
pnpm --filter @token-burn/web test -- src/app/setup/page.test.tsx src/app/setup/setup-command-copy.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the setup page integration**

Run:

```bash
git add apps/web/src/app/setup/page.tsx apps/web/src/app/setup/page.test.tsx
git commit -m "feat: make setup command copyable"
```

Expected: commit succeeds.

## Task 4: Verification

**Files:**
- Verify repository state after Tasks 1-3.

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

- [ ] **Step 4: Run web build with required env vars**

Run:

```bash
ADMIN_GITHUB_LOGIN=admin-user AUTH_GITHUB_ID=test-github-id AUTH_GITHUB_SECRET=test-github-secret AUTH_SECRET=test-auth-secret AUTH_URL=http://127.0.0.1:3000 DATABASE_URL=postgresql://tokenburn:tokenburn@127.0.0.1:5432/tokenburn TOKEN_BURN_PUBLIC_URL=https://tokenburn.example.com pnpm --filter @token-burn/web build
```

Expected: PASS and route summary still includes `/setup`.

- [ ] **Step 5: Check worktree**

Run:

```bash
git status --short
```

Expected: clean working tree.

## Self-Review

- Spec coverage: The plan covers a client copy component, exact command text, success/failure messages, setup page integration, and focused tests.
- Placeholder scan: No placeholders, deferred work, or unspecified test steps remain.
- Type consistency: The command constant, helper name, component name, labels, and messages are consistent across tests and implementation.
