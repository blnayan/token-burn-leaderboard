# Seamless Member Usage Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep member usage charts visible while filter requests are in flight.

**Architecture:** Update `MemberUsageDialog` to distinguish initial loading from refresh loading. Preserve the last successful detail during refreshes and only replace it on successful responses.

**Tech Stack:** React, Next.js client components, Vitest, Testing Library, shadcn/ui Skeleton/Card/Button.

---

## File Structure

- Modify `apps/web/src/components/member-usage-dialog.test.tsx` to cover stale-while-refresh behavior.
- Modify `apps/web/src/components/member-usage-dialog.tsx` to preserve existing detail while filter requests load.

### Task 1: Stale-While-Refresh Dialog Loading

**Files:**
- Modify: `apps/web/src/components/member-usage-dialog.test.tsx`
- Modify: `apps/web/src/components/member-usage-dialog.tsx`

- [ ] **Step 1: Write the failing test**

Add a test that opens the dialog, waits for initial member usage, clicks a mocked provider filter, leaves the second fetch unresolved, and asserts the prior summary and chart controls remain visible.

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --dir apps/web test -- src/components/member-usage-dialog.test.tsx
```

Expected: FAIL because filter loading replaces the chart with the loading skeleton.

- [ ] **Step 3: Implement stale-while-refresh state**

Change the dialog load state so an in-flight request with existing detail keeps rendering the success content. Initial loading still renders `MemberUsageLoading`.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --dir apps/web test -- src/components/member-usage-dialog.test.tsx
pnpm --dir apps/web typecheck
```

Expected: PASS.
