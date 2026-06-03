# Pre-Launch Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Token Burn before broader use by improving sync resilience, CLI health visibility, duplicate-device recovery UX, and privacy/UTC documentation.

**Architecture:** Keep leaderboard storage and sync payload contracts intact. Add one public health route, make optional model breakdown parsing non-fatal in the CLI, enrich `status` and `doctor` with local/server health context, polish device conflict messaging, and document the privacy boundary.

**Tech Stack:** TypeScript, Commander, Zod, Next.js App Router route handlers, Vitest, Markdown docs.

---

## File Structure

- `packages/cli/src/version.ts`: single source of truth for CLI version used by `index.ts`, `status`, and `doctor`.
- `apps/web/src/app/api/cli/health/route.ts`: public server health and CLI-version guidance endpoint.
- `packages/cli/src/ccusage.ts`: optional model breakdown parsing resilience.
- `packages/cli/src/ccusage.test.ts`: regression for malformed optional model data.
- `packages/cli/src/commands/status.ts`: richer local status plus non-fatal server health check.
- `packages/cli/src/commands/status.test.ts`: status output tests.
- `packages/cli/src/commands/doctor.ts`: richer setup diagnostics plus duplicate-device warning.
- `packages/cli/src/commands/doctor.test.ts`: new doctor output tests.
- `packages/cli/src/commands/devices.ts`: conflict messaging polish.
- `packages/cli/src/commands/devices.test.ts`: conflict display tests.
- `packages/cli/README.md` and `docs/cli-install.md`: privacy, UTC, and config-deletion recovery docs.

### Task 1: ccusage Optional Detail Resilience

**Files:**
- Modify: `packages/cli/src/ccusage.ts`
- Modify: `packages/cli/src/ccusage.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside `describe("normalizeCcusageDailyRows", ...)` in `packages/cli/src/ccusage.test.ts` after the existing model-breakdown tests:

```ts
  it("keeps provider totals when optional model breakdowns are malformed", () => {
    const rows = normalizeCcusageDailyRows("claude_code", [
      {
        date: "2026-06-01",
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 10,
        cacheReadTokens: 20,
        totalTokens: 180,
        totalCost: 0.42,
        modelBreakdowns: [
          {
            inputTokens: 100,
            outputTokens: 50,
            cacheCreationTokens: 10,
            cacheReadTokens: 20,
            totalTokens: 180,
          },
        ],
      },
    ]);

    expect(rows).toEqual([
      {
        provider: "claude_code",
        date: "2026-06-01",
        tokenCategories: {
          input: 100,
          output: 50,
          cacheCreate: 10,
          cacheRead: 20,
        },
        totalTokens: 180,
        costUsd: 0.42,
        costSource: "ccusage",
        sourceSnapshot: {
          cacheCreationTokens: 10,
          cacheReadTokens: 20,
          inputTokens: 100,
          outputTokens: 50,
          totalCost: 0.42,
          totalTokens: 180,
        },
      },
    ]);
  });
```

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
pnpm --filter token-burn test -- src/ccusage.test.ts
```

Expected: FAIL with `ccusage model breakdown row is missing a model name`.

- [ ] **Step 3: Implement non-fatal optional model parsing**

In `packages/cli/src/ccusage.ts`, change:

```ts
const models = normalizeModelUsage(record.models ?? record.modelBreakdowns);
```

to:

```ts
const models = normalizeOptionalModelUsage(record.models ?? record.modelBreakdowns);
```

Add this helper near `normalizeModelUsage`:

```ts
function normalizeOptionalModelUsage(models: unknown): NormalizedModelUsage[] {
  try {
    return normalizeModelUsage(models);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run the focused test and verify green**

Run:

```bash
pnpm --filter token-burn test -- src/ccusage.test.ts
```

Expected: PASS with all ccusage tests green.

### Task 2: Server Health Endpoint And CLI Version Source

**Files:**
- Create: `apps/web/src/app/api/cli/health/route.ts`
- Create: `packages/cli/src/version.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Add the CLI version module**

Create `packages/cli/src/version.ts`:

```ts
import { readFileSync } from "node:fs";

export const cliVersion = readCliVersion();

function readCliVersion(): string {
  const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  const parsed = JSON.parse(raw) as { version?: unknown };

  if (typeof parsed.version !== "string" || !parsed.version) {
    throw new Error("Unable to determine CLI version.");
  }

  return parsed.version;
}
```

- [ ] **Step 2: Use the CLI version module in the entrypoint**

In `packages/cli/src/index.ts`, add:

```ts
import { cliVersion } from "./version.js";
```

Change:

```ts
.version("<manual-version>");
```

to:

```ts
.version(cliVersion);
```

- [ ] **Step 3: Add the health route**

Create `apps/web/src/app/api/cli/health/route.ts`:

```ts
import { NextResponse } from "next/server";

import { requiredCliVersion } from "@/server/cli-version";

export async function GET() {
  return NextResponse.json({
    requiredCliVersion,
    serverTime: new Date().toISOString(),
  });
}
```

- [ ] **Step 4: Verify route and CLI types**

Run:

```bash
pnpm --filter @token-burn/web typecheck
pnpm --filter token-burn typecheck
```

Expected: both commands exit 0.

### Task 3: Richer Status Output

**Files:**
- Modify: `packages/cli/src/commands/status.ts`
- Modify: `packages/cli/src/commands/status.test.ts`

- [ ] **Step 1: Write failing status tests**

In `packages/cli/src/commands/status.test.ts`, update the logged-in test to inject a health response and assert version/device/upgrade output:

```ts
    await runStatus({
      readConfig: async () => ({
        serverUrl: "https://token-burn.test",
        token: "tb_secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        lastSync: {
          ok: true,
          message: "Synced 42 tokens",
          at: "2026-06-01T00:00:00.000Z",
        },
      }),
      readHealth: async () => ({
        requiredCliVersion: "<next-package-version>",
        serverTime: "2026-06-03T00:00:00.000Z",
      }),
      log,
    });

    expect(log).toHaveBeenCalledWith(`CLI version: ${cliVersion}.`);
    expect(log).toHaveBeenCalledWith("Authenticated with https://token-burn.test.");
    expect(log).toHaveBeenCalledWith("Device: nayan-vps (4f43b27d-7d86-4ff8-8c98-f74158819e59).");
    expect(log).toHaveBeenCalledWith("Last sync: OK - Synced 42 tokens at 2026-06-01T00:00:00.000Z.");
    expect(log).toHaveBeenCalledWith(
      `Token Burn requires token-burn <next-package-version>. You have ${cliVersion}. Run npm install -g @blnayan/token-burn@latest.`,
    );
```

Add a test for health-check failures:

```ts
  it("keeps local status useful when server health fails", async () => {
    const log = vi.fn();

    await runStatus({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "tb_secret" }),
      readHealth: async () => {
        throw new Error("network down");
      },
      log,
    });

    expect(log).toHaveBeenCalledWith(`CLI version: ${cliVersion}.`);
    expect(log).toHaveBeenCalledWith("Authenticated with https://token-burn.test.");
    expect(log).toHaveBeenCalledWith("Server health check failed: network down.");
  });
```

- [ ] **Step 2: Run status tests and verify red**

Run:

```bash
pnpm --filter token-burn test -- src/commands/status.test.ts
```

Expected: FAIL because `readHealth` and richer output do not exist.

- [ ] **Step 3: Implement status health helpers**

In `packages/cli/src/commands/status.ts`, import `cliVersion` and add:

```ts
type CliHealth = {
  requiredCliVersion: string;
  serverTime: string;
};

type HealthReader = (serverUrl: string) => Promise<CliHealth>;

async function readHealthFromServer(serverUrl: string): Promise<CliHealth> {
  const response = await fetch(`${serverUrl.replace(/\/+$/, "")}/api/cli/health`);
  const data = (await response.json()) as unknown;

  if (!response.ok || !data || typeof data !== "object") {
    throw new Error(`HTTP ${response.status}`);
  }

  const record = data as Partial<CliHealth>;
  if (
    typeof record.requiredCliVersion !== "string" ||
    typeof record.serverTime !== "string"
  ) {
    throw new Error("Invalid health response");
  }

  return {
    requiredCliVersion: record.requiredCliVersion,
    serverTime: record.serverTime,
  };
}

function isVersionLessThan(left: string, right: string): boolean {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);

  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart < rightPart) return true;
    if (leftPart > rightPart) return false;
  }

  return false;
}
```

Extend `StatusDependencies`:

```ts
readHealth?: HealthReader;
```

At the start of `runStatus`, log:

```ts
log(`CLI version: ${cliVersion}.`);
```

When authenticated and `deviceId`/`deviceName` exist, log:

```ts
log(`Device: ${config.deviceName} (${config.deviceId}).`);
```

After local state, call `readHealth(config.serverUrl)` in a `try/catch`; print the required-version hint if `cliVersion !== health.requiredCliVersion`. On failure, print `Server health check failed: ${message}.`

- [ ] **Step 4: Run status tests and verify green**

Run:

```bash
pnpm --filter token-burn test -- src/commands/status.test.ts
```

Expected: PASS.

### Task 4: Richer Doctor Output And Duplicate Warning

**Files:**
- Create: `packages/cli/src/commands/doctor.test.ts`
- Modify: `packages/cli/src/commands/doctor.ts`

- [ ] **Step 1: Write failing doctor tests**

Create `packages/cli/src/commands/doctor.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { runDoctor } from "./doctor.js";

describe("runDoctor", () => {
  it("prints local setup and duplicate-device warnings", async () => {
    const log = vi.fn();

    await runDoctor({
      readConfig: async () => ({
        serverUrl: "https://token-burn.test",
        token: "tb_secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        lastSync: {
          ok: false,
          message: "Failed providers: claude_code",
          at: "2026-06-01T00:00:00.000Z",
        },
      }),
      platform: "linux",
      readHealth: async () => ({
        requiredCliVersion: cliVersion,
        serverTime: "2026-06-03T00:00:00.000Z",
      }),
      readDevices: async () => ({
        devices: [],
        duplicateGroups: [
          {
            name: "nayan-vps",
            os: "linux",
            duplicateRows: 2,
            conflictRows: 0,
            devices: [],
          },
        ],
      }),
      log,
    });

    expect(log).toHaveBeenCalledWith(`CLI version: ${cliVersion}.`);
    expect(log).toHaveBeenCalledWith("Authenticated with https://token-burn.test.");
    expect(log).toHaveBeenCalledWith("Device: nayan-vps (4f43b27d-7d86-4ff8-8c98-f74158819e59).");
    expect(log).toHaveBeenCalledWith("Platform: linux.");
    expect(log).toHaveBeenCalledWith(
      "Last sync: Failed - Failed providers: claude_code at 2026-06-01T00:00:00.000Z.",
    );
    expect(log).toHaveBeenCalledWith("Likely duplicate devices found. Run token-burn devices to inspect and merge.");
    expect(log).toHaveBeenCalledWith("Run token-burn sync to submit usage now.");
  });
});
```

- [ ] **Step 2: Run doctor tests and verify red**

Run:

```bash
pnpm --filter token-burn test -- src/commands/doctor.test.ts
```

Expected: FAIL because `readHealth`, `readDevices`, and richer output are missing.

- [ ] **Step 3: Implement doctor dependencies and output**

In `packages/cli/src/commands/doctor.ts`, mirror the local output rules from `status.ts`. Add dependency types:

```ts
readHealth?: (serverUrl: string) => Promise<{ requiredCliVersion: string; serverTime: string }>;
readDevices?: (serverUrl: string, token: string) => Promise<{ duplicateGroups: Array<{ name: string; os: string; duplicateRows: number; conflictRows: number }> }>;
```

Use default implementations that call `/api/cli/health` and `/api/cli/devices`.

When authenticated, call `readDevices` in a `try/catch`. If `duplicateGroups.length > 0`, log:

```ts
Likely duplicate devices found. Run token-burn devices to inspect and merge.
```

Device-list failures should not make doctor fail; log:

```ts
Device check failed: <message>.
```

- [ ] **Step 4: Run doctor tests and verify green**

Run:

```bash
pnpm --filter token-burn test -- src/commands/doctor.test.ts
```

Expected: PASS.

### Task 5: Device Conflict Messaging

**Files:**
- Modify: `packages/cli/src/commands/devices.ts`
- Modify: `packages/cli/src/commands/devices.test.ts`

- [ ] **Step 1: Write failing devices tests**

Add a duplicate-group test case with `conflictRows: 1` in `packages/cli/src/commands/devices.test.ts`. Assert:

```ts
expect(log).toHaveBeenCalledWith("Nayans-MacBook-Air.local / darwin: 0 duplicate rows, 1 conflicts");
expect(log).toHaveBeenCalledWith(
  "Merge blocked: same provider/date rows have different totals. Ask an admin to inspect before merging.",
);
```

Add a merge failure test by injecting a `postJson` function that throws:

```ts
await expect(
  runMergeDevices({
    sourceDeviceId: "old-device",
    targetDeviceId: "new-device",
    readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "tb_secret" }),
    postJson: async () => {
      throw new Error("Cannot merge devices with conflicting usage rows.");
    },
    log: vi.fn(),
  }),
).rejects.toThrow("Cannot merge devices with conflicting usage rows.");
```

- [ ] **Step 2: Run devices tests and verify red**

Run:

```bash
pnpm --filter token-burn test -- src/commands/devices.test.ts
```

Expected: FAIL because conflict warning output is missing.

- [ ] **Step 3: Implement conflict warning output**

In `runListDevices`, after logging the group summary, add:

```ts
if (group.conflictRows > 0) {
  log("Merge blocked: same provider/date rows have different totals. Ask an admin to inspect before merging.");
  continue;
}
```

Keep merge suggestions only for zero-conflict groups.

- [ ] **Step 4: Run devices tests and verify green**

Run:

```bash
pnpm --filter token-burn test -- src/commands/devices.test.ts
```

Expected: PASS.

### Task 6: Privacy And UTC Documentation

**Files:**
- Modify: `packages/cli/README.md`
- Modify: `docs/cli-install.md`

- [ ] **Step 1: Update CLI README**

Add this section to `packages/cli/README.md` after the command list:

```md
## Privacy

Token Burn syncs aggregate daily usage only.

Stored by Token Burn:

- Daily aggregate token totals
- Provider name
- Model names when `ccusage` reports them
- Token categories such as input, output, cache creation, and cache read
- Reasoning output token details when reported
- Cost estimates when `ccusage` reports them
- Device name, OS, CLI version, `ccusage` version, and sync timestamp

Not stored by Token Burn:

- Prompts
- Raw conversation text
- Project paths or file paths
- Session IDs
- Raw `ccusage` rows
- GitHub OAuth tokens
- Raw CLI tokens

Leaderboard periods use UTC boundaries. "Today" means the current UTC date.
```

- [ ] **Step 2: Update install docs with recovery note**

Add this section to `docs/cli-install.md` after the user install instructions:

```md
## Device Identity And Recovery

Token Burn stores a random per-install device ID in `~/.config/token-burn/config.json`.
Normal npm uninstall/reinstall keeps this config file, so the same device identity is reused.

If the config file is deleted, the next sync creates a new device. To recover duplicated history:

```bash
token-burn login
token-burn sync
token-burn devices
token-burn devices merge <old-device-id> <new-device-id>
```

Do not edit the database manually unless you are repairing a server-side incident.
```

- [ ] **Step 3: Verify docs contain required terms**

Run:

```bash
rg -n "Not stored|UTC|Device Identity|model names|Prompts|config.json" packages/cli/README.md docs/cli-install.md
```

Expected: all terms appear.

### Task 7: Final Verification

**Files:**
- Existing changed files only.

- [ ] **Step 1: Run focused CLI tests**

Run:

```bash
pnpm --filter token-burn test -- src/ccusage.test.ts src/commands/status.test.ts src/commands/doctor.test.ts src/commands/devices.test.ts src/commands/login.test.ts src/sync.test.ts src/config.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run web typecheck**

Run:

```bash
pnpm --filter @token-burn/web typecheck
```

Expected: exit 0.

- [ ] **Step 3: Run CLI typecheck and build**

Run:

```bash
pnpm --filter token-burn typecheck
pnpm --filter token-burn build
```

Expected: both commands exit 0 and the CLI build reports `Build success`.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add apps/web/src/app/api/cli/health/route.ts \
  packages/cli/src/version.ts \
  packages/cli/src/index.ts \
  packages/cli/src/ccusage.ts \
  packages/cli/src/ccusage.test.ts \
  packages/cli/src/commands/status.ts \
  packages/cli/src/commands/status.test.ts \
  packages/cli/src/commands/doctor.ts \
  packages/cli/src/commands/doctor.test.ts \
  packages/cli/src/commands/devices.ts \
  packages/cli/src/commands/devices.test.ts \
  packages/cli/README.md \
  docs/cli-install.md
git commit -m "feat: harden prelaunch cli diagnostics"
```
