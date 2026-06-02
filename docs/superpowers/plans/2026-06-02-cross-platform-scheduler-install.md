# Cross-Platform Scheduler Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `token-burn install-scheduler` and `token-burn uninstall-scheduler` perform real user-level scheduler changes on Linux, macOS, and Windows.

**Architecture:** Keep scheduler string builders pure and testable, then add an injected scheduler runtime that owns filesystem writes and process execution. CLI commands call the runtime for real installs and keep `--dry-run` as a no-mutation preview.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Node.js `child_process`, Vitest, Commander.

---

## File Structure

- Modify `packages/cli/src/scheduler.ts`: scheduler builders, install/uninstall orchestration, injected filesystem/process helpers, platform constants.
- Modify `packages/cli/src/commands/scheduler.ts`: call real install/uninstall runtime instead of printing guidance for normal execution.
- Modify `packages/cli/src/scheduler.test.ts`: add TDD coverage for systemd units, cron block replacement, macOS launchd install, Windows schtasks install, uninstall behavior, and dry-run behavior.
- No web or database files change.

## Task 1: Linux Systemd And Cron Builders

**Files:**
- Modify: `packages/cli/src/scheduler.ts`
- Test: `packages/cli/src/scheduler.test.ts`

- [ ] **Step 1: Write failing builder tests**

Add tests under `describe("scheduler builders", ...)`:

```ts
it("builds a systemd user service and timer for 15 minute sync", () => {
  const service = buildSystemdService(["/usr/bin/node", "/repo/dist/index.js", "sync"]);
  const timer = buildSystemdTimer();

  expect(service).toContain("[Service]");
  expect(service).toContain("Type=oneshot");
  expect(service).toContain("ExecStart=/usr/bin/node /repo/dist/index.js sync");
  expect(timer).toContain("OnBootSec=5min");
  expect(timer).toContain("OnUnitActiveSec=15min");
  expect(timer).toContain("Unit=token-burn-sync.service");
});

it("wraps the cron line in stable marker comments", () => {
  expect(buildCronBlock(["/usr/local/bin/token-burn", "sync"])).toBe(
    [
      "# BEGIN Token Burn scheduler",
      "*/15 * * * * '/usr/local/bin/token-burn' 'sync' >> /tmp/token-burn-sync.log 2>&1",
      "# END Token Burn scheduler",
    ].join("\n"),
  );
});

it("replaces an existing marked cron block without duplicating it", () => {
  const existing = [
    "MAILTO=me@example.com",
    "# BEGIN Token Burn scheduler",
    "*/15 * * * * old command",
    "# END Token Burn scheduler",
    "0 0 * * * echo midnight",
  ].join("\n");

  expect(mergeCronBlock(existing, buildCronBlock(["token-burn", "sync"]))).toBe(
    [
      "MAILTO=me@example.com",
      "# BEGIN Token Burn scheduler",
      "*/15 * * * * 'token-burn' 'sync' >> /tmp/token-burn-sync.log 2>&1",
      "# END Token Burn scheduler",
      "0 0 * * * echo midnight",
      "",
    ].join("\n"),
  );
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter token-burn test -- src/scheduler.test.ts`

Expected: FAIL because `buildSystemdService`, `buildSystemdTimer`, `buildCronBlock`, and `mergeCronBlock` are not exported.

- [ ] **Step 3: Add pure Linux builders**

In `packages/cli/src/scheduler.ts`, add exports:

```ts
const cronStartMarker = "# BEGIN Token Burn scheduler";
const cronEndMarker = "# END Token Burn scheduler";

export function buildSystemdService(commandArgv: SchedulerCommandArgv): string {
  return [
    "[Unit]",
    "Description=Token Burn sync",
    "",
    "[Service]",
    "Type=oneshot",
    `ExecStart=${commandArgv.map(systemdEscapeArg).join(" ")}`,
    "",
  ].join("\n");
}

export function buildSystemdTimer(): string {
  return [
    "[Unit]",
    "Description=Run Token Burn sync every 15 minutes",
    "",
    "[Timer]",
    "OnBootSec=5min",
    "OnUnitActiveSec=15min",
    "Unit=token-burn-sync.service",
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
}

export function buildCronBlock(commandArgv: SchedulerCommandArgv): string {
  return [cronStartMarker, buildCronLine(commandArgv), cronEndMarker].join("\n");
}

export function mergeCronBlock(existingCrontab: string, block: string): string {
  const markerPattern = new RegExp(`${escapeRegExp(cronStartMarker)}[\\s\\S]*?${escapeRegExp(cronEndMarker)}\\n?`, "m");
  const withoutExisting = existingCrontab.replace(markerPattern, "").trimEnd();
  return `${withoutExisting ? `${withoutExisting}\n` : ""}${block}\n`;
}

function systemdEscapeArg(value: string): string {
  if (!/[\s"\\]/.test(value)) return value;
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `pnpm --filter token-burn test -- src/scheduler.test.ts`

Expected: PASS for the new builder tests and existing scheduler tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/scheduler.ts packages/cli/src/scheduler.test.ts
git commit -m "feat(cli): add scheduler file builders"
```

## Task 2: Scheduler Runtime Interface And Linux Install

**Files:**
- Modify: `packages/cli/src/scheduler.ts`
- Test: `packages/cli/src/scheduler.test.ts`

- [ ] **Step 1: Write failing Linux runtime tests**

Add tests under `describe("scheduler install runtime", ...)`:

```ts
it("installs a Linux systemd user timer when systemd is available", async () => {
  const runtime = createMockSchedulerRuntime({ platform: "linux", homeDir: "/home/me" });

  await installScheduler({ runtime, syncCommandArgv: ["/usr/bin/node", "/repo/dist/index.js", "sync"] });

  expect(runtime.files.get("/home/me/.config/systemd/user/token-burn-sync.service")).toContain("ExecStart=/usr/bin/node /repo/dist/index.js sync");
  expect(runtime.files.get("/home/me/.config/systemd/user/token-burn-sync.timer")).toContain("OnUnitActiveSec=15min");
  expect(runtime.commands).toEqual([
    ["systemctl", ["--user", "daemon-reload"]],
    ["systemctl", ["--user", "enable", "--now", "token-burn-sync.timer"]],
  ]);
});

it("falls back to cron when Linux user systemd is unavailable", async () => {
  const runtime = createMockSchedulerRuntime({
    platform: "linux",
    homeDir: "/home/me",
    failingCommands: new Set(["systemctl --user daemon-reload"]),
    commandOutput: new Map([["crontab -l", "0 0 * * * echo midnight\n"]]),
  });

  await installScheduler({ runtime, syncCommandArgv: ["token-burn", "sync"] });

  expect(runtime.commands).toContainEqual(["crontab", ["-l"]]);
  expect(runtime.stdinCommands).toEqual([
    {
      command: "crontab",
      args: ["-"],
      input: [
        "0 0 * * * echo midnight",
        "# BEGIN Token Burn scheduler",
        "*/15 * * * * 'token-burn' 'sync' >> /tmp/token-burn-sync.log 2>&1",
        "# END Token Burn scheduler",
        "",
      ].join("\n"),
    },
  ]);
});
```

Define the local test helper in `scheduler.test.ts`:

```ts
function createMockSchedulerRuntime(options: {
  platform: NodeJS.Platform;
  homeDir: string;
  failingCommands?: Set<string>;
  commandOutput?: Map<string, string>;
}) {
  const files = new Map<string, string>();
  const commands: Array<[string, string[]]> = [];
  const stdinCommands: Array<{ command: string; args: string[]; input: string }> = [];

  return {
    platform: options.platform,
    homeDir: options.homeDir,
    files,
    commands,
    stdinCommands,
    async mkdir() {},
    async writeFile(path: string, content: string) {
      files.set(path, content);
    },
    async rm(path: string) {
      files.delete(path);
    },
    async execFile(command: string, args: string[]) {
      commands.push([command, args]);
      const key = [command, ...args].join(" ");
      if (options.failingCommands?.has(key)) throw new Error(`failed: ${key}`);
      return options.commandOutput?.get(key) ?? "";
    },
    async execFileWithInput(command: string, args: string[], input: string) {
      stdinCommands.push({ command, args, input });
      const key = [command, ...args].join(" ");
      if (options.failingCommands?.has(key)) throw new Error(`failed: ${key}`);
    },
  };
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter token-burn test -- src/scheduler.test.ts`

Expected: FAIL because `installScheduler` and the runtime type do not exist.

- [ ] **Step 3: Add runtime interface and Linux install**

Add to `packages/cli/src/scheduler.ts`:

```ts
export type SchedulerRuntime = {
  platform: SchedulerPlatform;
  homeDir: string;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  rm(path: string): Promise<void>;
  execFile(command: string, args: string[]): Promise<string>;
  execFileWithInput(command: string, args: string[], input: string): Promise<void>;
};

export async function installScheduler({
  runtime,
  syncCommandArgv,
}: {
  runtime: SchedulerRuntime;
  syncCommandArgv: SchedulerCommandArgv;
}): Promise<string> {
  if (runtime.platform === "linux") return installLinuxScheduler(runtime, syncCommandArgv);
  throw new Error(`Unsupported scheduler platform: ${runtime.platform}`);
}

async function installLinuxScheduler(runtime: SchedulerRuntime, syncCommandArgv: SchedulerCommandArgv): Promise<string> {
  try {
    await installLinuxSystemdScheduler(runtime, syncCommandArgv);
    return "Installed Token Burn systemd user timer token-burn-sync.timer.";
  } catch (error) {
    await installLinuxCronScheduler(runtime, syncCommandArgv);
    return `Installed Token Burn cron entry after systemd user timer was unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function installLinuxSystemdScheduler(runtime: SchedulerRuntime, syncCommandArgv: SchedulerCommandArgv): Promise<void> {
  const dir = `${runtime.homeDir}/.config/systemd/user`;
  await runtime.mkdir(dir);
  await runtime.writeFile(`${dir}/token-burn-sync.service`, buildSystemdService(syncCommandArgv));
  await runtime.writeFile(`${dir}/token-burn-sync.timer`, buildSystemdTimer());
  await runtime.execFile("systemctl", ["--user", "daemon-reload"]);
  await runtime.execFile("systemctl", ["--user", "enable", "--now", "token-burn-sync.timer"]);
}

async function installLinuxCronScheduler(runtime: SchedulerRuntime, syncCommandArgv: SchedulerCommandArgv): Promise<void> {
  const existing = await runtime.execFile("crontab", ["-l"]).catch(() => "");
  await runtime.execFileWithInput("crontab", ["-"], mergeCronBlock(existing, buildCronBlock(syncCommandArgv)));
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `pnpm --filter token-burn test -- src/scheduler.test.ts`

Expected: PASS for Linux install and fallback tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/scheduler.ts packages/cli/src/scheduler.test.ts
git commit -m "feat(cli): install linux scheduler"
```

## Task 3: macOS And Windows Install

**Files:**
- Modify: `packages/cli/src/scheduler.ts`
- Test: `packages/cli/src/scheduler.test.ts`

- [ ] **Step 1: Write failing macOS and Windows install tests**

Add tests:

```ts
it("installs a macOS launchd agent", async () => {
  const runtime = createMockSchedulerRuntime({ platform: "darwin", homeDir: "/Users/me" });

  await installScheduler({ runtime, syncCommandArgv: ["/usr/local/bin/node", "/repo/dist/index.js", "sync"] });

  const plistPath = "/Users/me/Library/LaunchAgents/com.token-burn.sync.plist";
  expect(runtime.files.get(plistPath)).toContain("<string>com.token-burn.sync</string>");
  expect(runtime.commands).toEqual([
    ["launchctl", ["unload", plistPath]],
    ["launchctl", ["load", plistPath]],
  ]);
});

it("installs a Windows scheduled task", async () => {
  const runtime = createMockSchedulerRuntime({ platform: "win32", homeDir: "C:\\Users\\Me" });

  await installScheduler({
    runtime,
    syncCommandArgv: ["C:\\Program Files\\nodejs\\node.exe", "C:\\Users\\Me\\token burn\\dist\\index.js", "sync"],
  });

  expect(runtime.commands).toEqual([
    [
      "schtasks",
      [
        "/Create",
        "/TN",
        "TokenBurnSync",
        "/SC",
        "MINUTE",
        "/MO",
        "15",
        "/TR",
        '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Me\\token burn\\dist\\index.js" sync',
        "/F",
      ],
    ],
  ]);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter token-burn test -- src/scheduler.test.ts`

Expected: FAIL because `installScheduler` only supports Linux.

- [ ] **Step 3: Add macOS and Windows install paths**

Update `installScheduler`:

```ts
if (runtime.platform === "darwin") return installMacScheduler(runtime, syncCommandArgv);
if (runtime.platform === "win32") return installWindowsScheduler(runtime, syncCommandArgv);
```

Add helpers:

```ts
async function installMacScheduler(runtime: SchedulerRuntime, syncCommandArgv: SchedulerCommandArgv): Promise<string> {
  const dir = `${runtime.homeDir}/Library/LaunchAgents`;
  const plistPath = `${dir}/${launchdLabel}.plist`;
  await runtime.mkdir(dir);
  await runtime.writeFile(plistPath, buildLaunchdPlist(syncCommandArgv));
  await runtime.execFile("launchctl", ["unload", plistPath]).catch(() => "");
  await runtime.execFile("launchctl", ["load", plistPath]);
  return `Installed Token Burn launchd agent ${plistPath}.`;
}

async function installWindowsScheduler(runtime: SchedulerRuntime, syncCommandArgv: SchedulerCommandArgv): Promise<string> {
  await runtime.execFile("schtasks", buildWindowsTaskArgs(syncCommandArgv));
  return "Installed Token Burn Windows scheduled task TokenBurnSync.";
}

export function buildWindowsTaskArgs(commandArgv: SchedulerCommandArgv): string[] {
  return [
    "/Create",
    "/TN",
    windowsTaskName,
    "/SC",
    "MINUTE",
    "/MO",
    "15",
    "/TR",
    commandArgv.map(windowsQuoteIfNeeded).join(" "),
    "/F",
  ];
}
```

Update `buildWindowsTaskCommand` to use `buildWindowsTaskArgs`:

```ts
export function buildWindowsTaskCommand(commandArgv: SchedulerCommandArgv): string {
  return `schtasks ${buildWindowsTaskArgs(commandArgv).map(windowsQuoteIfNeeded).join(" ")}`;
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `pnpm --filter token-burn test -- src/scheduler.test.ts`

Expected: PASS for Linux, macOS, Windows builder and install tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/scheduler.ts packages/cli/src/scheduler.test.ts
git commit -m "feat(cli): install mac and windows schedulers"
```

## Task 4: Uninstall Runtime

**Files:**
- Modify: `packages/cli/src/scheduler.ts`
- Test: `packages/cli/src/scheduler.test.ts`

- [ ] **Step 1: Write failing uninstall tests**

Add tests:

```ts
it("uninstalls Linux scheduler artifacts", async () => {
  const runtime = createMockSchedulerRuntime({
    platform: "linux",
    homeDir: "/home/me",
    commandOutput: new Map([
      [
        "crontab -l",
        [
          "# BEGIN Token Burn scheduler",
          "*/15 * * * * 'token-burn' 'sync' >> /tmp/token-burn-sync.log 2>&1",
          "# END Token Burn scheduler",
          "0 0 * * * echo midnight",
          "",
        ].join("\n"),
      ],
    ]),
  });

  await uninstallScheduler({ runtime });

  expect(runtime.commands).toContainEqual(["systemctl", ["--user", "disable", "--now", "token-burn-sync.timer"]]);
  expect(runtime.commands).toContainEqual(["systemctl", ["--user", "daemon-reload"]]);
  expect(runtime.stdinCommands).toEqual([{ command: "crontab", args: ["-"], input: "0 0 * * * echo midnight\n" }]);
});

it("uninstalls macOS launchd agent", async () => {
  const runtime = createMockSchedulerRuntime({ platform: "darwin", homeDir: "/Users/me" });

  await uninstallScheduler({ runtime });

  const plistPath = "/Users/me/Library/LaunchAgents/com.token-burn.sync.plist";
  expect(runtime.commands).toEqual([["launchctl", ["unload", plistPath]]]);
});

it("uninstalls Windows scheduled task", async () => {
  const runtime = createMockSchedulerRuntime({ platform: "win32", homeDir: "C:\\Users\\Me" });

  await uninstallScheduler({ runtime });

  expect(runtime.commands).toEqual([["schtasks", ["/Delete", "/TN", "TokenBurnSync", "/F"]]]);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter token-burn test -- src/scheduler.test.ts`

Expected: FAIL because `uninstallScheduler` does not exist.

- [ ] **Step 3: Add uninstall runtime**

Add to `packages/cli/src/scheduler.ts`:

```ts
export async function uninstallScheduler({ runtime }: { runtime: SchedulerRuntime }): Promise<string> {
  if (runtime.platform === "linux") return uninstallLinuxScheduler(runtime);
  if (runtime.platform === "darwin") return uninstallMacScheduler(runtime);
  if (runtime.platform === "win32") return uninstallWindowsScheduler(runtime);
  throw new Error(`Unsupported scheduler platform: ${runtime.platform}`);
}

async function uninstallLinuxScheduler(runtime: SchedulerRuntime): Promise<string> {
  const dir = `${runtime.homeDir}/.config/systemd/user`;
  await runtime.execFile("systemctl", ["--user", "disable", "--now", "token-burn-sync.timer"]).catch(() => "");
  await runtime.rm(`${dir}/token-burn-sync.service`).catch(() => "");
  await runtime.rm(`${dir}/token-burn-sync.timer`).catch(() => "");
  await runtime.execFile("systemctl", ["--user", "daemon-reload"]).catch(() => "");
  const existing = await runtime.execFile("crontab", ["-l"]).catch(() => "");
  await runtime.execFileWithInput("crontab", ["-"], removeCronBlock(existing));
  return "Removed Token Burn Linux scheduler entries.";
}

async function uninstallMacScheduler(runtime: SchedulerRuntime): Promise<string> {
  const plistPath = `${runtime.homeDir}/Library/LaunchAgents/${launchdLabel}.plist`;
  await runtime.execFile("launchctl", ["unload", plistPath]).catch(() => "");
  await runtime.rm(plistPath).catch(() => "");
  return `Removed Token Burn launchd agent ${plistPath}.`;
}

async function uninstallWindowsScheduler(runtime: SchedulerRuntime): Promise<string> {
  await runtime.execFile("schtasks", ["/Delete", "/TN", windowsTaskName, "/F"]);
  return "Removed Token Burn Windows scheduled task TokenBurnSync.";
}

export function removeCronBlock(existingCrontab: string): string {
  const markerPattern = new RegExp(`${escapeRegExp(cronStartMarker)}[\\s\\S]*?${escapeRegExp(cronEndMarker)}\\n?`, "m");
  const withoutExisting = existingCrontab.replace(markerPattern, "").trimEnd();
  return withoutExisting ? `${withoutExisting}\n` : "";
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `pnpm --filter token-burn test -- src/scheduler.test.ts`

Expected: PASS for scheduler uninstall tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/scheduler.ts packages/cli/src/scheduler.test.ts
git commit -m "feat(cli): uninstall schedulers"
```

## Task 5: Real Node Runtime And CLI Wiring

**Files:**
- Modify: `packages/cli/src/scheduler.ts`
- Modify: `packages/cli/src/commands/scheduler.ts`
- Test: `packages/cli/src/scheduler.test.ts`

- [ ] **Step 1: Write failing command wiring tests**

Update the existing non-dry-run scheduler command tests:

```ts
it("runs the injected installer when install is not a dry run", async () => {
  const log = vi.fn();
  const install = vi.fn(async () => "Installed Token Burn cron entry.");

  await runInstallScheduler({
    dryRun: false,
    platform: "linux",
    syncCommandArgv: ["token-burn", "sync"],
    install,
    log,
  });

  expect(install).toHaveBeenCalledWith("linux", ["token-burn", "sync"]);
  expect(log).toHaveBeenCalledWith("Installed Token Burn cron entry.");
});

it("runs the injected uninstaller", async () => {
  const log = vi.fn();
  const uninstall = vi.fn(async () => "Removed Token Burn scheduler.");

  await runUninstallScheduler({
    platform: "linux",
    uninstall,
    log,
  });

  expect(uninstall).toHaveBeenCalledWith("linux");
  expect(log).toHaveBeenCalledWith("Removed Token Burn scheduler.");
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter token-burn test -- src/scheduler.test.ts`

Expected: FAIL because command helpers are synchronous and do not accept installer injections.

- [ ] **Step 3: Add real runtime factory**

In `packages/cli/src/scheduler.ts`, import Node helpers:

```ts
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCallback);
```

Add runtime factory:

```ts
export function createNodeSchedulerRuntime(platform: SchedulerPlatform = process.platform): SchedulerRuntime {
  return {
    platform,
    homeDir: homedir(),
    async mkdir(path) {
      await mkdir(path, { recursive: true });
    },
    async writeFile(path, content) {
      await writeFile(path, content, "utf8");
    },
    async rm(path) {
      await rm(path, { force: true });
    },
    async execFile(command, args) {
      const { stdout } = await execFileAsync(command, args);
      return stdout;
    },
    async execFileWithInput(command, args, input) {
      await execFileAsync(command, args, { input });
    },
  };
}
```

- [ ] **Step 4: Wire command helpers to real runtime**

In `packages/cli/src/commands/scheduler.ts`, update types and functions:

```ts
import { createNodeSchedulerRuntime, installScheduler, uninstallScheduler } from "../scheduler.js";

export type InstallSchedulerOptions = {
  dryRun: boolean;
  platform?: SchedulerPlatform;
  syncCommandArgv?: SchedulerCommandArgv;
  install?: (platform: SchedulerPlatform, syncCommandArgv: SchedulerCommandArgv) => Promise<string>;
  log?: (message: string) => void;
};

export type UninstallSchedulerOptions = {
  platform?: SchedulerPlatform;
  uninstall?: (platform: SchedulerPlatform) => Promise<string>;
  log?: (message: string) => void;
};

export async function runInstallScheduler({
  dryRun,
  platform = process.platform,
  syncCommandArgv = getDefaultSyncCommandArgv(),
  install = async (selectedPlatform, selectedSyncCommandArgv) =>
    installScheduler({ runtime: createNodeSchedulerRuntime(selectedPlatform), syncCommandArgv: selectedSyncCommandArgv }),
  log = console.log,
}: InstallSchedulerOptions): Promise<void> {
  if (dryRun) {
    log(buildSchedulerInstallOutput(platform, syncCommandArgv));
    return;
  }

  log(await install(platform, syncCommandArgv));
}

export async function runUninstallScheduler({
  platform = process.platform,
  uninstall = async (selectedPlatform) => uninstallScheduler({ runtime: createNodeSchedulerRuntime(selectedPlatform) }),
  log = console.log,
}: UninstallSchedulerOptions = {}): Promise<void> {
  log(await uninstall(platform));
}
```

Update command `.action` handlers to `await` the async helpers.

- [ ] **Step 5: Run tests and verify they pass**

Run: `pnpm --filter token-burn test -- src/scheduler.test.ts`

Expected: PASS for all scheduler tests.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/scheduler.ts packages/cli/src/commands/scheduler.ts packages/cli/src/scheduler.test.ts
git commit -m "feat(cli): wire scheduler commands to installers"
```

## Task 6: Final Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run CLI tests**

Run: `pnpm --filter token-burn test`

Expected: PASS with all CLI tests green.

- [ ] **Step 2: Run root test suite**

Run: `pnpm test`

Expected: PASS for shared, web, and CLI.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 4: Run lint**

Run: `pnpm lint`

Expected: PASS.

- [ ] **Step 5: Run build**

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 6: Run Docker build**

Run: `docker compose --env-file .env.example build`

Expected: PASS.

- [ ] **Step 7: Commit verification-only changes if any**

If formatting or lockfile changes are produced by verification, commit them:

```bash
git add packages/cli/src/scheduler.ts packages/cli/src/commands/scheduler.ts packages/cli/src/scheduler.test.ts
git commit -m "chore: verify scheduler install"
```

If there are no verification-only changes, do not create an empty commit.
