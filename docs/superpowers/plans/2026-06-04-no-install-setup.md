# No-Install Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `token-burn setup` as the primary no-install onboarding command and make installed schedulers run the latest published CLI.

**Architecture:** Keep existing CLI commands available. Add a small setup command that composes existing login, sync, and scheduler command functions through dependency injection. Change scheduler default argv generation so OS-native scheduled jobs invoke npm's latest package runner instead of the current CLI entrypoint.

**Tech Stack:** TypeScript, Commander, Vitest, Node 24, npm `exec`, pnpm workspaces.

---

## File Structure

- Modify `packages/cli/src/commands/scheduler.ts`: make default scheduler argv latest-resolving via npm, with Windows using `npm.cmd`.
- Modify `packages/cli/src/scheduler.test.ts`: update scheduler argv expectations and dry-run expectations.
- Create `packages/cli/src/commands/setup.ts`: compose login, sync, and scheduler installation.
- Create `packages/cli/src/commands/setup.test.ts`: unit test setup ordering, server URL forwarding, sync-failure continuation, and scheduler-failure reporting.
- Modify `packages/cli/src/index.ts`: register the new `setup` command.
- Modify `packages/cli/README.md`: lead with `npx @blnayan/token-burn@latest setup`.
- Modify `docs/cli-install.md`: document no-install setup and clarify global install is optional.
- Modify `README.md`: update quick start to no-install setup.
- Modify `packages/cli/package.json`: bump CLI version for publish.
- Modify `apps/web/src/generated/required-cli-version.ts`: regenerate from CLI package version.

---

### Task 1: Make Scheduler Jobs Run The Latest CLI

**Files:**
- Modify: `packages/cli/src/commands/scheduler.ts`
- Modify: `packages/cli/src/scheduler.test.ts`

- [ ] **Step 1: Write failing scheduler argv tests**

Modify the `describe("scheduler commands")` block in `packages/cli/src/scheduler.test.ts`.

Replace the current default-entrypoint tests with:

```ts
  it("defaults to npm latest sync on Linux and macOS", () => {
    expect(getDefaultSyncCommandArgv({ platform: "linux" })).toEqual([
      "npm",
      "exec",
      "--yes",
      "--package",
      "@blnayan/token-burn@latest",
      "--",
      "token-burn",
      "sync",
    ]);

    expect(getDefaultSyncCommandArgv({ platform: "darwin" })).toEqual([
      "npm",
      "exec",
      "--yes",
      "--package",
      "@blnayan/token-burn@latest",
      "--",
      "token-burn",
      "sync",
    ]);
  });

  it("defaults to npm.cmd latest sync on Windows", () => {
    expect(getDefaultSyncCommandArgv({ platform: "win32" })).toEqual([
      "npm.cmd",
      "exec",
      "--yes",
      "--package",
      "@blnayan/token-burn@latest",
      "--",
      "token-burn",
      "sync",
    ]);
  });
```

Update the dry-run test input and expectations:

```ts
    await runInstallScheduler({
      dryRun: true,
      platform: "linux",
      syncCommandArgv: [
        "npm",
        "exec",
        "--yes",
        "--package",
        "@blnayan/token-burn@latest",
        "--",
        "token-burn",
        "sync",
      ],
      log,
    });
```

Expected assertions:

```ts
    expect(output).toContain(
      "ExecStart=npm exec --yes --package @blnayan/token-burn@latest -- token-burn sync",
    );
    expect(output).toContain(
      "*/15 * * * * 'npm' 'exec' '--yes' '--package' '@blnayan/token-burn@latest' '--' 'token-burn' 'sync' >> /tmp/token-burn-sync.log 2>&1",
    );
```

- [ ] **Step 2: Run scheduler tests to verify failure**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/scheduler.test.ts
```

Expected: tests fail because `getDefaultSyncCommandArgv` still returns the current Node entrypoint.

- [ ] **Step 3: Implement latest scheduler argv**

Modify `packages/cli/src/commands/scheduler.ts`.

Replace `getDefaultSyncCommandArgv` with:

```ts
export function getDefaultSyncCommandArgv({
  platform = process.platform,
}: {
  platform?: SchedulerPlatform;
} = {}): SchedulerCommandArgv {
  const npmCommand = platform === "win32" ? "npm.cmd" : "npm";

  return [
    npmCommand,
    "exec",
    "--yes",
    "--package",
    "@blnayan/token-burn@latest",
    "--",
    "token-burn",
    "sync",
  ];
}
```

In `runInstallScheduler`, change the default `syncCommandArgv` to use the selected platform:

```ts
  syncCommandArgv = getDefaultSyncCommandArgv({ platform }),
```

- [ ] **Step 4: Run scheduler tests to verify pass**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/scheduler.test.ts
```

Expected: all scheduler tests pass.

- [ ] **Step 5: Commit scheduler change**

Run:

```bash
git add packages/cli/src/commands/scheduler.ts packages/cli/src/scheduler.test.ts
git commit -m "feat: run scheduled sync with latest cli"
```

---

### Task 2: Add Setup Command Tests

**Files:**
- Create: `packages/cli/src/commands/setup.test.ts`

- [ ] **Step 1: Create failing setup tests**

Create `packages/cli/src/commands/setup.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { runSetup } from "./setup.js";

describe("runSetup", () => {
  it("runs login, sync, and scheduler install in order", async () => {
    const events: string[] = [];
    const log = vi.fn();

    await runSetup({
      serverUrl: "https://token-burn.test",
      login: async ({ serverUrl }) => {
        events.push(`login:${serverUrl}`);
      },
      sync: async () => {
        events.push("sync");
      },
      installScheduler: async ({ dryRun }) => {
        events.push(`install:${dryRun}`);
      },
      log,
    });

    expect(events).toEqual(["login:https://token-burn.test", "sync", "install:false"]);
    expect(log).toHaveBeenCalledWith("Setup complete. Automatic sync will run every 15 minutes.");
  });

  it("passes --server-url through to login", async () => {
    const login = vi.fn(async () => undefined);

    await runSetup({
      serverUrl: "https://custom-token-burn.test",
      login,
      sync: async () => undefined,
      installScheduler: async () => undefined,
      log: vi.fn(),
    });

    expect(login).toHaveBeenCalledWith({ serverUrl: "https://custom-token-burn.test" });
  });

  it("stops when login fails", async () => {
    const sync = vi.fn(async () => undefined);
    const installScheduler = vi.fn(async () => undefined);

    await expect(
      runSetup({
        serverUrl: "https://token-burn.test",
        login: async () => {
          throw new Error("Login session expired before approval.");
        },
        sync,
        installScheduler,
        log: vi.fn(),
      }),
    ).rejects.toThrow("Login session expired before approval.");

    expect(sync).not.toHaveBeenCalled();
    expect(installScheduler).not.toHaveBeenCalled();
  });

  it("attempts scheduler install when first sync fails after login", async () => {
    const installScheduler = vi.fn(async () => undefined);
    const log = vi.fn();

    await runSetup({
      serverUrl: "https://token-burn.test",
      login: async () => undefined,
      sync: async () => {
        throw new Error("All supported providers failed: codex: fixture missing.");
      },
      installScheduler,
      log,
    });

    expect(installScheduler).toHaveBeenCalledWith({ dryRun: false });
    expect(log).toHaveBeenCalledWith(
      "First sync failed: All supported providers failed: codex: fixture missing.",
    );
    expect(log).toHaveBeenCalledWith("Automatic sync was still installed and will retry every 15 minutes.");
  });

  it("reports scheduler install failure clearly", async () => {
    await expect(
      runSetup({
        serverUrl: "https://token-burn.test",
        login: async () => undefined,
        sync: async () => undefined,
        installScheduler: async () => {
          throw new Error("systemd user timer unavailable");
        },
        log: vi.fn(),
      }),
    ).rejects.toThrow(
      "Setup authenticated and attempted the first sync, but automatic sync was not installed: systemd user timer unavailable. Retry with npx @blnayan/token-burn@latest install-scheduler.",
    );
  });
});
```

- [ ] **Step 2: Run setup tests to verify failure**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/commands/setup.test.ts
```

Expected: fails because `./setup.js` does not exist.

- [ ] **Step 3: Commit failing tests**

Do not commit a failing test-only state if following one-commit-per-green-change policy in this repo. Keep the failing tests unstaged until Task 3 makes them pass.

---

### Task 3: Implement Setup Command

**Files:**
- Create: `packages/cli/src/commands/setup.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/src/commands/setup.test.ts`

- [ ] **Step 1: Create setup command implementation**

Create `packages/cli/src/commands/setup.ts`:

```ts
import { Command } from "commander";

import { defaultServerUrl } from "../defaults.js";
import { runInstallScheduler } from "./scheduler.js";
import { runLogin } from "./login.js";
import { runSync } from "./sync.js";

type SetupLogin = (options: { serverUrl: string }) => Promise<void>;
type SetupInstallScheduler = (options: { dryRun: boolean }) => Promise<void>;

export type SetupOptions = {
  serverUrl: string;
  login?: SetupLogin;
  sync?: () => Promise<void>;
  installScheduler?: SetupInstallScheduler;
  log?: (message: string) => void;
};

export async function runSetup({
  serverUrl,
  login = runLogin,
  sync = runSync,
  installScheduler = runInstallScheduler,
  log = console.log,
}: SetupOptions): Promise<void> {
  log("Starting Token Burn setup.");
  await login({ serverUrl });
  log("Login complete.");

  let syncFailed = false;
  try {
    await sync();
    log("First sync complete.");
  } catch (error) {
    syncFailed = true;
    log(`First sync failed: ${formatErrorMessage(error)}`);
  }

  try {
    await installScheduler({ dryRun: false });
  } catch (error) {
    throw new Error(
      `Setup authenticated and attempted the first sync, but automatic sync was not installed: ${formatErrorMessage(
        error,
      )}. Retry with npx @blnayan/token-burn@latest install-scheduler.`,
    );
  }

  if (syncFailed) {
    log("Automatic sync was still installed and will retry every 15 minutes.");
  }

  log("Setup complete. Automatic sync will run every 15 minutes.");
}

export function createSetupCommand(): Command {
  return new Command("setup")
    .description("Authenticate, sync once, and install automatic Token Burn sync")
    .option("-s, --server-url <url>", "Token Burn server URL")
    .option("--server <url>", "Alias for --server-url")
    .action(async (options: { serverUrl?: string; server?: string }) => {
      await runSetup({ serverUrl: options.serverUrl ?? options.server ?? defaultServerUrl() });
    });
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 2: Register setup command**

Modify `packages/cli/src/index.ts`.

Add import:

```ts
import { createSetupCommand } from "./commands/setup.js";
```

Register setup before the individual commands:

```ts
program.addCommand(createSetupCommand());
program.addCommand(createLoginCommand());
```

- [ ] **Step 3: Run setup tests to verify pass**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/commands/setup.test.ts
```

Expected: all setup tests pass.

- [ ] **Step 4: Run targeted CLI tests**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/commands/setup.test.ts src/scheduler.test.ts src/commands/login.test.ts src/sync.test.ts
```

Expected: all targeted CLI tests pass.

- [ ] **Step 5: Commit setup command**

Run:

```bash
git add packages/cli/src/commands/setup.ts packages/cli/src/commands/setup.test.ts packages/cli/src/index.ts
git commit -m "feat: add no-install setup command"
```

---

### Task 4: Update Documentation For No-Install Setup

**Files:**
- Modify: `README.md`
- Modify: `packages/cli/README.md`
- Modify: `docs/cli-install.md`

- [ ] **Step 1: Update root README quick start**

In `README.md`, replace the current quick-start command block with:

````md
```bash
npx @blnayan/token-burn@latest setup
```
````

Replace the following explanatory paragraphs with:

````md
`setup` prints a browser approval URL, waits for login approval, runs the first sync, and installs automatic sync.

The scheduler installed by setup runs the latest published CLI each time:

```bash
npm exec --yes --package @blnayan/token-burn@latest -- token-burn sync
```

This means users do not need a global `token-burn` install for normal usage.
````

Keep the useful command list, but introduce it as optional:

```md
Optional troubleshooting commands:
```

- [ ] **Step 2: Update CLI README install section**

In `packages/cli/README.md`, replace the install and login section with:

````md
## Quick Start

Requires Node.js 24 LTS or newer.

```bash
npx @blnayan/token-burn@latest setup
```

`setup` prints a login approval URL, waits for approval, runs the first sync, and installs automatic sync.

You can still install the CLI globally if you prefer:

```bash
npm install -g @blnayan/token-burn
token-burn setup
```
````

In the commands list, add:

```md
- `token-burn setup` authenticates, syncs once, and installs automatic sync.
```

- [ ] **Step 3: Update CLI install doc**

In `docs/cli-install.md`, replace the user install opening section with:

````md
## User Setup

Token Burn CLI requires Node.js 24 LTS or newer.

Recommended no-install setup:

```bash
npx @blnayan/token-burn@latest setup
```

The npm package is `@blnayan/token-burn`. The command run by npx is `token-burn`.

Setup prints a login approval URL, waits for approval, runs the first sync, and installs a scheduler. The scheduler uses npm to run the latest published CLI:

```bash
npm exec --yes --package @blnayan/token-burn@latest -- token-burn sync
```

Optional global install:

```bash
npm install -g @blnayan/token-burn
token-burn setup
```
````

Keep the device recovery section, but update recovery commands to use no-install style:

```bash
npx @blnayan/token-burn@latest setup
npx @blnayan/token-burn@latest devices
npx @blnayan/token-burn@latest devices merge <old-device-id> <new-device-id>
```

- [ ] **Step 4: Run docs formatting check**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 5: Commit docs**

Run:

```bash
git add README.md packages/cli/README.md docs/cli-install.md
git commit -m "docs: lead with no-install setup"
```

---

### Task 5: Bump CLI Version And Regenerate Server Contract

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `apps/web/src/generated/required-cli-version.ts`

- [ ] **Step 1: Bump CLI package version**

Modify `packages/cli/package.json`:

```json
{
  "name": "@blnayan/token-burn",
  "version": "0.1.8"
}
```

Only change the `version` value.

- [ ] **Step 2: Regenerate required CLI version**

Run:

```bash
pnpm generate:cli-version
```

Expected output includes:

```text
Generated apps/web/src/generated/required-cli-version.ts from packages/cli/package.json (0.1.8).
```

- [ ] **Step 3: Verify generated version**

Run:

```bash
rg -n '0\.1\.8|0\.1\.7' packages/cli/package.json apps/web/src/generated/required-cli-version.ts
```

Expected: `0.1.8` appears in `packages/cli/package.json` and `apps/web/src/generated/required-cli-version.ts`. `0.1.7` does not appear in those files.

- [ ] **Step 4: Commit version bump**

Run:

```bash
git add packages/cli/package.json apps/web/src/generated/required-cli-version.ts
git commit -m "chore: bump cli to 0.1.8"
```

---

### Task 6: Full Verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run full tests**

Run:

```bash
pnpm test
```

Expected: all workspace tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: all workspace typechecks pass.

- [ ] **Step 3: Run lint**

Run:

```bash
pnpm lint
```

Expected: lint passes.

- [ ] **Step 4: Run production build**

Run:

```bash
pnpm build
```

Expected: shared, CLI, and web builds pass.

- [ ] **Step 5: Run CLI prepublish check**

Run:

```bash
pnpm --filter @blnayan/token-burn prepublishOnly
```

Expected: CLI tests, typecheck, build, and npm pack dry-run pass. Tarball is `@blnayan/token-burn@0.1.8`.

- [ ] **Step 6: Run packaged CLI E2E**

Run:

```bash
node scripts/e2e-cli-cross-platform.mjs
```

Expected:

```text
Cross-platform packaged CLI E2E passed.
```

- [ ] **Step 7: Run Linux root global install smoke**

Run:

```bash
tmpdir=$(mktemp -d)
(cd packages/cli && npm pack --pack-destination "$tmpdir" >/tmp/token-burn-pack-output.txt)
tarball="$tmpdir/$(tail -n 1 /tmp/token-burn-pack-output.txt)"
bash scripts/smoke-cli-linux-root-global-install.sh "$tarball"
rm -rf "$tmpdir" /tmp/token-burn-pack-output.txt
```

Expected: installed CLI reports `0.1.8`; smoke exits 0.

- [ ] **Step 8: Check final diff**

Run:

```bash
git status --short
git diff --check
```

Expected: no unstaged unrelated files, no whitespace errors.

---

### Task 7: Push And Watch CI

**Files:**
- Git only.

- [ ] **Step 1: Push main**

Run:

```bash
git push origin main
```

Expected: push succeeds.

- [ ] **Step 2: Watch GitHub Actions**

Run:

```bash
gh run list --repo blnayan/token-burn-leaderboard --branch main --limit 3
```

Find the CI run for the latest commit, then:

```bash
gh run watch <run-id> --repo blnayan/token-burn-leaderboard --exit-status
```

Expected: Unit, Linux Root Global Install, CLI E2E on Ubuntu/macOS/Windows, and Sync E2E all pass.

---

## Self-Review Checklist

- Spec coverage: setup command, no auto browser open, existing commands retained, latest scheduler command, sync-failure continuation, scheduler-failure error, docs, tests, and version bump are all covered.
- Red-flag phrase scan: clean.
- Type consistency: `runSetup`, `createSetupCommand`, `getDefaultSyncCommandArgv`, and dependency names are consistent across tests and implementation steps.
