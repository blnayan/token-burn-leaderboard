# Device Merge Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users detect and explicitly merge duplicate Token Burn devices created after local config deletion or re-login bugs.

**Architecture:** Add a server-side device service that lists member devices, detects likely duplicate groups, and merges two member-owned devices with conflict checks. Expose the service through CLI-token authenticated API routes, then add `token-burn devices` and `token-burn devices merge <source> <target>` commands.

**Tech Stack:** TypeScript, Next.js route handlers, Prisma, Commander, Zod, Vitest.

---

### Task 1: Server Device Service

**Files:**
- Create: `apps/web/src/server/devices.ts`
- Test: `apps/web/src/server/devices.test.ts`

- [ ] **Step 1: Write failing tests**

Cover listing member devices with aggregate totals, detecting likely duplicates by same name and OS with matching provider/date totals, merging duplicate rows by deleting source duplicates, moving non-conflicting rows, deleting the empty source device, and refusing conflicting provider/date totals.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @token-burn/web test -- src/server/devices.test.ts`

Expected: FAIL because `devices.ts` does not exist.

- [ ] **Step 3: Implement service**

Create functions `listMemberDevices` and `mergeMemberDevices`. Keep inputs as member id plus server DB ids. Return compact DTOs for CLI display.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @token-burn/web test -- src/server/devices.test.ts`

Expected: PASS.

### Task 2: Device API Routes

**Files:**
- Create: `apps/web/src/app/api/cli/devices/route.ts`
- Create: `apps/web/src/app/api/cli/devices/merge/route.ts`
- Modify if useful: `apps/web/src/app/api/sync/route.ts` auth helper duplication remains local unless a small shared helper clearly reduces risk.

- [ ] **Step 1: Add route tests if existing route test style supports it**

Prefer service tests for DB behavior. Route logic should authenticate bearer token, validate input, call service, and return JSON.

- [ ] **Step 2: Implement routes**

Use the same CLI token lookup pattern as `/api/sync`. `GET /api/cli/devices` returns `{ devices, duplicateGroups }`. `POST /api/cli/devices/merge` accepts `{ sourceDeviceId, targetDeviceId }`.

- [ ] **Step 3: Verify web tests**

Run: `pnpm --filter @token-burn/web test -- src/server/devices.test.ts`

Expected: PASS.

### Task 3: CLI Devices Commands

**Files:**
- Create: `packages/cli/src/commands/devices.ts`
- Create: `packages/cli/src/commands/devices.test.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Write failing CLI tests**

Cover unauthenticated errors, listing devices and duplicate groups, and merge POST payload/output.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter token-burn test -- src/commands/devices.test.ts`

Expected: FAIL because `devices.ts` does not exist.

- [ ] **Step 3: Implement command**

Add `token-burn devices` and `token-burn devices merge <source> <target>`. Use existing config and HTTP helpers.

- [ ] **Step 4: Register command and verify**

Run: `pnpm --filter token-burn test -- src/commands/devices.test.ts src/commands/login.test.ts src/sync.test.ts src/config.test.ts src/ccusage.test.ts`

Expected: PASS.

### Task 4: Full Verification

**Files:**
- Existing changed files only.

- [ ] **Step 1: Typecheck CLI and web**

Run: `pnpm --filter token-burn typecheck`

Run: `pnpm --filter @token-burn/web typecheck`

- [ ] **Step 2: Run focused tests**

Run: `pnpm --filter @token-burn/web test -- src/server/devices.test.ts`

Run: `pnpm --filter token-burn test -- src/commands/devices.test.ts src/commands/login.test.ts src/sync.test.ts src/config.test.ts src/ccusage.test.ts`

- [ ] **Step 3: Summarize safe production cleanup**

Use `token-burn devices` to identify duplicate device ids, then `token-burn devices merge <old> <new>` to remove duplicate rows and move any unique source rows.
