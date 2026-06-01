import { describe, expect, it, vi } from "vitest";

import { runDoctor } from "./commands/doctor.js";
import { runInstallScheduler, runUninstallScheduler } from "./commands/scheduler.js";
import { buildCronLine, buildLaunchdPlist, buildWindowsTaskCommand } from "./scheduler.js";

describe("scheduler builders", () => {
  it("builds a cron line that syncs every 15 minutes and logs to tmp", () => {
    expect(buildCronLine("/usr/local/bin/token-burn")).toBe(
      "*/15 * * * * /usr/local/bin/token-burn sync >> /tmp/token-burn-sync.log 2>&1",
    );
  });

  it("builds a launchd plist with the expected interval, label, and command", () => {
    const plist = buildLaunchdPlist("/usr/local/bin/token-burn");

    expect(plist).toContain("<string>com.token-burn.sync</string>");
    expect(plist).toContain("<key>StartInterval</key>");
    expect(plist).toContain("<integer>900</integer>");
    expect(plist).toContain("<string>/usr/local/bin/token-burn</string>");
    expect(plist).toContain("<string>sync</string>");
  });

  it("builds a Windows scheduled task command for a 15 minute sync", () => {
    const command = buildWindowsTaskCommand("C:\\Tools\\token-burn.cmd");

    expect(command).toContain("/SC MINUTE /MO 15");
    expect(command).toContain('/TR "\\"C:\\Tools\\token-burn.cmd\\" sync"');
  });
});

describe("scheduler commands", () => {
  it("prints generated scheduler content on dry run", () => {
    const log = vi.fn();

    runInstallScheduler({
      dryRun: true,
      platform: "linux",
      binaryPath: "/usr/local/bin/token-burn",
      log,
    });

    expect(log).toHaveBeenCalledWith("*/15 * * * * /usr/local/bin/token-burn sync >> /tmp/token-burn-sync.log 2>&1");
  });

  it("prints dry-run-first guidance when install is not a dry run", () => {
    const log = vi.fn();

    runInstallScheduler({
      dryRun: false,
      platform: "linux",
      binaryPath: "/usr/local/bin/token-burn",
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
