import { describe, expect, it, vi } from "vitest";

import { runDoctor } from "./commands/doctor.js";
import { getDefaultSyncCommandArgv, runInstallScheduler, runUninstallScheduler } from "./commands/scheduler.js";
import {
  buildCronBlock,
  buildCronLine,
  buildLaunchdPlist,
  buildSystemdService,
  buildSystemdTimer,
  buildWindowsTaskCommand,
  mergeCronBlock,
} from "./scheduler.js";

describe("scheduler builders", () => {
  it("builds a cron line that syncs every 15 minutes and logs to tmp", () => {
    expect(buildCronLine(["/usr/local/bin/token-burn", "sync"])).toBe(
      "*/15 * * * * '/usr/local/bin/token-burn' 'sync' >> /tmp/token-burn-sync.log 2>&1",
    );
  });

  it("shell-quotes every cron command argument independently", () => {
    expect(buildCronLine(["/opt/node bin/node", "/tmp/token burn/dist/index.js", "sync"])).toBe(
      "*/15 * * * * '/opt/node bin/node' '/tmp/token burn/dist/index.js' 'sync' >> /tmp/token-burn-sync.log 2>&1",
    );
  });

  it("shell-quotes cron command arguments with shell metacharacters", () => {
    expect(buildCronLine(["/tmp/a&b/node", "/tmp/project;rm/index.js", "sync"])).toBe(
      "*/15 * * * * '/tmp/a&b/node' '/tmp/project;rm/index.js' 'sync' >> /tmp/token-burn-sync.log 2>&1",
    );
  });

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

  it("builds a launchd plist with the expected interval, label, and command", () => {
    const plist = buildLaunchdPlist(["/usr/local/bin/node", "/tmp/token-burn/dist/index.js", "sync"]);

    expect(plist).toContain("<string>com.token-burn.sync</string>");
    expect(plist).toContain("<key>StartInterval</key>");
    expect(plist).toContain("<integer>900</integer>");
    expect(plist).toContain("<string>/usr/local/bin/node</string>");
    expect(plist).toContain("<string>/tmp/token-burn/dist/index.js</string>");
    expect(plist).toContain("<string>sync</string>");
  });

  it("XML-escapes launchd command arguments", () => {
    const plist = buildLaunchdPlist(["/tmp/token&burn/index.js", "sync"]);

    expect(plist).toContain("<string>/tmp/token&amp;burn/index.js</string>");
  });

  it("builds a Windows scheduled task command for a 15 minute sync", () => {
    const command = buildWindowsTaskCommand([
      "C:\\Program Files\\nodejs\\node.exe",
      "C:\\Users\\Me\\token burn\\dist\\index.js",
      "sync",
    ]);

    expect(command).toContain("/SC MINUTE /MO 15");
    expect(command).toContain(
      '/TR "\\"C:\\Program Files\\nodejs\\node.exe\\" \\"C:\\Users\\Me\\token burn\\dist\\index.js\\" sync"',
    );
  });
});

describe("scheduler commands", () => {
  it("defaults to invoking the current CLI entrypoint through node", () => {
    expect(
      getDefaultSyncCommandArgv({
        argv: ["/usr/bin/node", "/repo/packages/cli/dist/index.js", "install-scheduler", "--dry-run"],
        execPath: "/usr/bin/node",
      }),
    ).toEqual(["/usr/bin/node", "/repo/packages/cli/dist/index.js", "sync"]);
  });

  it("falls back to the installed binary name when no CLI entrypoint is present", () => {
    expect(getDefaultSyncCommandArgv({ argv: ["/usr/bin/node"], execPath: "/usr/bin/node" })).toEqual([
      "token-burn",
      "sync",
    ]);
  });

  it("prints generated scheduler content on dry run", () => {
    const log = vi.fn();

    runInstallScheduler({
      dryRun: true,
      platform: "linux",
      syncCommandArgv: ["/usr/bin/node", "/repo/packages/cli/dist/index.js", "sync"],
      log,
    });

    expect(log).toHaveBeenCalledWith(
      "*/15 * * * * '/usr/bin/node' '/repo/packages/cli/dist/index.js' 'sync' >> /tmp/token-burn-sync.log 2>&1",
    );
  });

  it("prints dry-run-first guidance when install is not a dry run", () => {
    const log = vi.fn();

    runInstallScheduler({
      dryRun: false,
      platform: "linux",
      log,
    });

    expect(log).toHaveBeenCalledWith("Run token-burn install-scheduler --dry-run, review the generated cron entry, then install it with crontab.");
  });

  it("prints platform removal guidance", () => {
    const log = vi.fn();

    runUninstallScheduler({ platform: "darwin", log });

    expect(log).toHaveBeenCalledWith("Remove ~/Library/LaunchAgents/com.token-burn.sync.plist, then run launchctl unload on that plist if it is loaded.");
  });
});

describe("doctor", () => {
  it("prints auth state, platform, and sync guidance", async () => {
    const log = vi.fn();

    await runDoctor({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
      platform: "linux",
      log,
    });

    expect(log).toHaveBeenCalledWith("Authenticated with https://token-burn.test.");
    expect(log).toHaveBeenCalledWith("Platform: linux.");
    expect(log).toHaveBeenCalledWith("Run token-burn sync to submit usage now.");
  });
});
