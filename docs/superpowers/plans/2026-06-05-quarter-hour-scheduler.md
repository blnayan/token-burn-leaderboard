# Quarter-Hour Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change automatic Token Burn scheduler generation so supported platforms recur on local wall-clock quarter-hour boundaries.

**Architecture:** Keep all platform artifact changes inside the existing pure scheduler builders in `packages/cli/src/scheduler.ts`, then let current install and dry-run orchestration consume those builders unchanged. Update existing Vitest coverage in `packages/cli/src/scheduler.test.ts` so builder, runtime-install, uninstall, and dry-run behavior prove the new quarter-hour schedule without changing the sync command or public scheduler names.

**Tech Stack:** TypeScript, Node.js, Vitest, Commander, systemd user timers, cron, launchd, Windows `schtasks`.

---

## File Structure

- Modify `packages/cli/src/scheduler.ts`: update `buildSystemdTimer`, `buildLaunchdPlist`, and `buildWindowsTaskArgs`; keep cron, task names, labels, install, and uninstall orchestration unchanged.
- Modify `packages/cli/src/scheduler.test.ts`: update existing builder/runtime/dry-run tests and add focused platform dry-run tests for Linux, macOS, and Windows quarter-hour output.
- No changes to `packages/cli/src/commands/scheduler.ts`: `runInstallScheduler` already delegates dry-run output to `buildSchedulerInstallOutput`, so builder updates flow through automatically.
- No changes to web, database, auth, login, setup, sync, or package metadata files.

## Task 1: Linux Systemd Quarter-Hour Timer

**Files:**
- Modify: `packages/cli/src/scheduler.ts`
- Test: `packages/cli/src/scheduler.test.ts`

- [ ] **Step 1: Write failing systemd builder test**

In `packages/cli/src/scheduler.test.ts`, replace the existing `it("builds a systemd user service and timer for 15 minute sync", ...)` test with:

```ts
it("builds a systemd user service and quarter-hour calendar timer", () => {
  const service = buildSystemdService(["/usr/bin/node", "/repo/dist/index.js", "sync"]);
  const timer = buildSystemdTimer();

  expect(service).toContain("[Service]");
  expect(service).toContain("Type=oneshot");
  expect(service).toContain("ExecStart=/usr/bin/node /repo/dist/index.js sync");
  expect(timer).toContain("OnCalendar=*:0/15");
  expect(timer).toContain("Persistent=true");
  expect(timer).toContain("Unit=token-burn-sync.service");
  expect(timer).not.toContain("OnBootSec=5min");
  expect(timer).not.toContain("OnUnitActiveSec=15min");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/scheduler.test.ts -t "systemd user service"
```

Expected: FAIL with output containing `expected '[Unit]...` and `to contain 'OnCalendar=*:0/15'` because `buildSystemdTimer()` still emits `OnBootSec=5min` and `OnUnitActiveSec=15min`.

- [ ] **Step 3: Implement systemd calendar timer**

In `packages/cli/src/scheduler.ts`, replace the full `buildSystemdTimer` function with:

```ts
export function buildSystemdTimer(): string {
  return [
    "[Unit]",
    "Description=Run Token Burn sync on quarter-hour boundaries",
    "",
    "[Timer]",
    "OnCalendar=*:0/15",
    "Persistent=true",
    "Unit=token-burn-sync.service",
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/scheduler.test.ts -t "systemd user service"
```

Expected: PASS for `builds a systemd user service and quarter-hour calendar timer`.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/scheduler.ts packages/cli/src/scheduler.test.ts
git commit -m "feat(cli): align systemd scheduler to quarter hours"
```

## Task 2: macOS And Windows Quarter-Hour Builders

**Files:**
- Modify: `packages/cli/src/scheduler.ts`
- Test: `packages/cli/src/scheduler.test.ts`

- [ ] **Step 1: Write failing launchd and Windows builder tests**

In `packages/cli/src/scheduler.test.ts`, replace the existing `it("builds a launchd plist with the expected interval, label, and command", ...)` test with:

```ts
it("builds a launchd plist with quarter-hour calendar entries, label, and command", () => {
  const plist = buildLaunchdPlist(["/usr/local/bin/node", "/tmp/token-burn/dist/index.js", "sync"]);

  expect(plist).toContain("<string>com.token-burn.sync</string>");
  expect(plist).toContain("<key>StartCalendarInterval</key>");
  expect(plist).toContain("<dict><key>Minute</key><integer>0</integer></dict>");
  expect(plist).toContain("<dict><key>Minute</key><integer>15</integer></dict>");
  expect(plist).toContain("<dict><key>Minute</key><integer>30</integer></dict>");
  expect(plist).toContain("<dict><key>Minute</key><integer>45</integer></dict>");
  expect(plist).not.toContain("<key>StartInterval</key>");
  expect(plist).not.toContain("<integer>900</integer>");
  expect(plist).toContain("<string>/usr/local/bin/node</string>");
  expect(plist).toContain("<string>/tmp/token-burn/dist/index.js</string>");
  expect(plist).toContain("<string>sync</string>");
  expect(plist).toContain("<key>StandardOutPath</key>");
  expect(plist).toContain("<key>StandardErrorPath</key>");
});
```

In the same file, replace the existing `it("builds a Windows scheduled task command for a 15 minute sync", ...)` test with:

```ts
it("builds a Windows scheduled task command anchored to quarter-hour boundaries", () => {
  const command = buildWindowsTaskCommand([
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\Users\\Me\\token burn\\dist\\index.js",
    "sync",
  ]);

  expect(command).toContain("/SC MINUTE /MO 15 /ST 00:00");
  expect(command).toContain(
    '/TR "\\"C:\\Program Files\\nodejs\\node.exe\\" \\"C:\\Users\\Me\\token burn\\dist\\index.js\\" sync"',
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/scheduler.test.ts -t "launchd plist|Windows scheduled task command"
```

Expected: FAIL with output containing `to contain '<key>StartCalendarInterval</key>'` and `to contain '/SC MINUTE /MO 15 /ST 00:00'` because launchd still uses `StartInterval` and Windows args still omit `/ST 00:00`.

- [ ] **Step 3: Implement launchd calendar entries**

In `packages/cli/src/scheduler.ts`, replace the full `buildLaunchdPlist` function with:

```ts
export function buildLaunchdPlist(commandArgv: SchedulerCommandArgv): string {
  const programArguments = commandArgv.map((arg) => `    <string>${escapeXml(arg)}</string>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(launchdLabel)}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Minute</key><integer>0</integer></dict>
    <dict><key>Minute</key><integer>15</integer></dict>
    <dict><key>Minute</key><integer>30</integer></dict>
    <dict><key>Minute</key><integer>45</integer></dict>
  </array>
  <key>StandardOutPath</key>
  <string>${escapeXml(cronLogPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(cronLogPath)}</string>
</dict>
</plist>`;
}
```

- [ ] **Step 4: Implement Windows midnight-anchored schedule**

In `packages/cli/src/scheduler.ts`, replace the full `buildWindowsTaskArgs` function with:

```ts
export function buildWindowsTaskArgs(commandArgv: SchedulerCommandArgv): string[] {
  return [
    "/Create",
    "/TN",
    windowsTaskName,
    "/SC",
    "MINUTE",
    "/MO",
    "15",
    "/ST",
    "00:00",
    "/TR",
    commandArgv.map(windowsQuoteIfNeeded).join(" "),
    "/F",
  ];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/scheduler.test.ts -t "launchd plist|Windows scheduled task command"
```

Expected: PASS for `builds a launchd plist with quarter-hour calendar entries, label, and command` and `builds a Windows scheduled task command anchored to quarter-hour boundaries`.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/scheduler.ts packages/cli/src/scheduler.test.ts
git commit -m "feat(cli): align macOS and Windows schedulers to quarter hours"
```

## Task 3: Install And Uninstall Orchestration Boundaries

**Files:**
- Modify: `packages/cli/src/scheduler.test.ts`
- Test: `packages/cli/src/scheduler.test.ts`

- [ ] **Step 1: Update Linux install runtime expectation**

In `packages/cli/src/scheduler.test.ts`, inside `it("installs a Linux systemd user timer when systemd is available", ...)`, replace this assertion:

```ts
expect(runtime.files.get("/home/me/.config/systemd/user/token-burn-sync.timer")).toContain(
  "OnUnitActiveSec=15min",
);
```

with:

```ts
expect(runtime.files.get("/home/me/.config/systemd/user/token-burn-sync.timer")).toContain("OnCalendar=*:0/15");
expect(runtime.files.get("/home/me/.config/systemd/user/token-burn-sync.timer")).toContain("Persistent=true");
expect(runtime.files.get("/home/me/.config/systemd/user/token-burn-sync.timer")).not.toContain(
  "OnUnitActiveSec=15min",
);
```

- [ ] **Step 2: Update macOS install runtime expectation**

In `packages/cli/src/scheduler.test.ts`, inside `it("installs a macOS launchd agent", ...)`, keep the existing label assertion and add these assertions immediately after it:

```ts
expect(runtime.files.get(plistPath)).toContain("<key>StartCalendarInterval</key>");
expect(runtime.files.get(plistPath)).toContain("<dict><key>Minute</key><integer>0</integer></dict>");
expect(runtime.files.get(plistPath)).toContain("<dict><key>Minute</key><integer>15</integer></dict>");
expect(runtime.files.get(plistPath)).toContain("<dict><key>Minute</key><integer>30</integer></dict>");
expect(runtime.files.get(plistPath)).toContain("<dict><key>Minute</key><integer>45</integer></dict>");
expect(runtime.files.get(plistPath)).not.toContain("<key>StartInterval</key>");
```

- [ ] **Step 3: Update Windows install runtime expectation**

In `packages/cli/src/scheduler.test.ts`, inside `it("installs a Windows scheduled task", ...)`, replace the expected `runtime.commands` array with:

```ts
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
      "/ST",
      "00:00",
      "/TR",
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Me\\token burn\\dist\\index.js" sync',
      "/F",
    ],
  ],
]);
```

- [ ] **Step 4: Verify uninstall tests still assert existing boundaries**

Confirm the Linux, macOS, and Windows uninstall tests still contain these expectations in `packages/cli/src/scheduler.test.ts`:

```ts
expect(runtime.commands).toContainEqual(["systemctl", ["--user", "disable", "--now", "token-burn-sync.timer"]]);
expect(runtime.stdinCommands).toEqual([{ command: "crontab", args: ["-"], input: "0 0 * * * echo midnight\n" }]);
expect(runtime.commands).toEqual([["launchctl", ["unload", plistPath]]]);
expect(runtime.commands).toEqual([["schtasks", ["/Delete", "/TN", "TokenBurnSync", "/F"]]]);
```

Do not edit uninstall implementation in this task; the spec says uninstall behavior should stay as-is.

- [ ] **Step 5: Run scheduler install runtime tests**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/scheduler.test.ts -t "scheduler install runtime"
```

Expected: PASS for all install and uninstall runtime tests.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/scheduler.test.ts
git commit -m "test(cli): cover quarter-hour scheduler installs"
```

## Task 4: Dry-Run Output For Each Platform

**Files:**
- Modify: `packages/cli/src/scheduler.test.ts`
- Test: `packages/cli/src/scheduler.test.ts`

- [ ] **Step 1: Update existing Linux dry-run test**

In `packages/cli/src/scheduler.test.ts`, inside `it("prints generated scheduler content on dry run", ...)`, replace:

```ts
expect(output).toContain("OnUnitActiveSec=15min");
```

with:

```ts
expect(output).toContain("OnCalendar=*:0/15");
expect(output).toContain("Persistent=true");
expect(output).not.toContain("OnUnitActiveSec=15min");
expect(output).not.toContain("OnBootSec=5min");
```

Keep the existing assertions that Linux dry-run output includes `token-burn-sync.service`, the `ExecStart=... token-burn sync` command, `token-burn-sync.timer`, `# Cron fallback`, and the `*/15 * * * *` cron line.

- [ ] **Step 2: Add macOS dry-run test**

Add this test under `describe("scheduler commands", ...)`, immediately after the Linux dry-run test:

```ts
it("prints macOS quarter-hour launchd content on dry run", async () => {
  const log = vi.fn();

  await runInstallScheduler({
    dryRun: true,
    platform: "darwin",
    syncCommandArgv: ["/usr/local/bin/node", "/repo/dist/index.js", "sync"],
    log,
  });

  const output = log.mock.calls[0]?.[0] as string;
  expect(output).toContain("<key>StartCalendarInterval</key>");
  expect(output).toContain("<dict><key>Minute</key><integer>0</integer></dict>");
  expect(output).toContain("<dict><key>Minute</key><integer>15</integer></dict>");
  expect(output).toContain("<dict><key>Minute</key><integer>30</integer></dict>");
  expect(output).toContain("<dict><key>Minute</key><integer>45</integer></dict>");
  expect(output).not.toContain("<key>StartInterval</key>");
  expect(output).toContain("<string>/usr/local/bin/node</string>");
  expect(output).toContain("<string>/repo/dist/index.js</string>");
  expect(output).toContain("<string>sync</string>");
});
```

- [ ] **Step 3: Add Windows dry-run test**

Add this test under `describe("scheduler commands", ...)`, immediately after the macOS dry-run test:

```ts
it("prints Windows quarter-hour scheduled task command on dry run", async () => {
  const log = vi.fn();

  await runInstallScheduler({
    dryRun: true,
    platform: "win32",
    syncCommandArgv: ["C:\\Program Files\\nodejs\\node.exe", "C:\\Users\\Me\\token burn\\dist\\index.js", "sync"],
    log,
  });

  const output = log.mock.calls[0]?.[0] as string;
  expect(output).toContain("schtasks /Create /TN TokenBurnSync /SC MINUTE /MO 15 /ST 00:00");
  expect(output).toContain(
    '/TR "\\"C:\\Program Files\\nodejs\\node.exe\\" \\"C:\\Users\\Me\\token burn\\dist\\index.js\\" sync"',
  );
});
```

- [ ] **Step 4: Run dry-run tests**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/scheduler.test.ts -t "dry run"
```

Expected: PASS for Linux, macOS, and Windows dry-run tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/scheduler.test.ts
git commit -m "test(cli): cover quarter-hour scheduler dry runs"
```

## Task 5: Full Verification

**Files:**
- Verify: `packages/cli/src/scheduler.ts`
- Verify: `packages/cli/src/scheduler.test.ts`

- [ ] **Step 1: Run focused scheduler tests**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/scheduler.test.ts
```

Expected: PASS for the full scheduler test file.

- [ ] **Step 2: Run CLI typecheck**

Run:

```bash
pnpm --filter @blnayan/token-burn typecheck
```

Expected: PASS with TypeScript reporting no errors.

- [ ] **Step 3: Inspect final scheduler artifacts manually**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/scheduler.test.ts -t "scheduler builders|dry run"
```

Expected: PASS. During review, confirm the test assertions cover:

```text
Linux systemd: OnCalendar=*:0/15 and Persistent=true
Linux cron: */15 * * * *
macOS launchd: StartCalendarInterval minutes 0, 15, 30, 45
Windows schtasks: /SC MINUTE /MO 15 /ST 00:00
Removed interval fields: OnBootSec, OnUnitActiveSec, StartInterval
Unchanged public names: com.token-burn.sync and TokenBurnSync
Unchanged sync command argv in service, plist, cron, and schtasks output
```

- [ ] **Step 4: Commit verification-only changes if needed**

If Steps 1-3 required a small correction, commit it:

```bash
git add packages/cli/src/scheduler.ts packages/cli/src/scheduler.test.ts
git commit -m "fix(cli): finalize quarter-hour scheduler alignment"
```

If Steps 1-3 passed without changes, do not create an empty commit.

## Self-Review Notes

- Spec coverage: Linux systemd switches to `OnCalendar=*:0/15` and `Persistent=true`; cron remains `*/15 * * * *`; macOS switches to `StartCalendarInterval`; Windows adds `/ST 00:00`; dry-run output covers all platform artifacts; install/uninstall orchestration boundaries remain unchanged.
- Placeholder scan: no deferred implementation, unspecified validation, or cross-task "same as above" instructions remain.
- Type consistency: all function names match current exports from `packages/cli/src/scheduler.ts` and command helpers from `packages/cli/src/commands/scheduler.ts`.
