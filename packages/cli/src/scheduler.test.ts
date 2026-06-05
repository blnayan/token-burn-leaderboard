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
  installScheduler,
  mergeCronBlock,
  uninstallScheduler,
} from "./scheduler.js";
import { cliVersion } from "./version.js";

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

  it("XML-escapes launchd command arguments", () => {
    const plist = buildLaunchdPlist(["/tmp/token&burn/index.js", "sync"]);

    expect(plist).toContain("<string>/tmp/token&amp;burn/index.js</string>");
  });

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
});

describe("scheduler install runtime", () => {
  it("installs a Linux systemd user timer when systemd is available", async () => {
    const runtime = createMockSchedulerRuntime({ platform: "linux", homeDir: "/home/me" });

    await installScheduler({ runtime, syncCommandArgv: ["/usr/bin/node", "/repo/dist/index.js", "sync"] });

    expect(runtime.files.get("/home/me/.config/systemd/user/token-burn-sync.service")).toContain(
      "ExecStart=/usr/bin/node /repo/dist/index.js sync",
    );
    expect(runtime.files.get("/home/me/.config/systemd/user/token-burn-sync.timer")).toContain(
      "OnUnitActiveSec=15min",
    );
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
});

describe("scheduler commands", () => {
  it("defaults to the npm CLI path when npm_execpath is available on Linux and macOS", () => {
    expect(
      getDefaultSyncCommandArgv({
        platform: "linux",
        execPath: "/usr/local/bin/node",
        npmExecPath: "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
      }),
    ).toEqual([
      "/usr/local/bin/node",
      "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
      "exec",
      "--yes",
      "--package",
      "@blnayan/token-burn@latest",
      "--",
      "token-burn",
      "sync",
    ]);

    expect(
      getDefaultSyncCommandArgv({
        platform: "darwin",
        execPath: "/opt/homebrew/bin/node",
        npmExecPath: "/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js",
      }),
    ).toEqual([
      "/opt/homebrew/bin/node",
      "/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js",
      "exec",
      "--yes",
      "--package",
      "@blnayan/token-burn@latest",
      "--",
      "token-burn",
      "sync",
    ]);
  });

  it("defaults to the npm CLI path when npm_execpath is available on Windows", () => {
    expect(
      getDefaultSyncCommandArgv({
        platform: "win32",
        execPath: "C:\\Program Files\\nodejs\\node.exe",
        npmExecPath: "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
      }),
    ).toEqual([
      "C:\\Program Files\\nodejs\\node.exe",
      "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
      "exec",
      "--yes",
      "--package",
      "@blnayan/token-burn@latest",
      "--",
      "token-burn",
      "sync",
    ]);
  });

  it("falls back to bare npm latest sync on Linux and macOS when npm_execpath is unavailable", () => {
    expect(getDefaultSyncCommandArgv({ platform: "linux", npmExecPath: "" })).toEqual([
      "npm",
      "exec",
      "--yes",
      "--package",
      "@blnayan/token-burn@latest",
      "--",
      "token-burn",
      "sync",
    ]);

    expect(getDefaultSyncCommandArgv({ platform: "darwin", npmExecPath: "" })).toEqual([
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

  it("falls back to bare npm.cmd latest sync on Windows when npm_execpath is unavailable", () => {
    expect(getDefaultSyncCommandArgv({ platform: "win32", npmExecPath: "" })).toEqual([
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

  it("falls back to bare npm when npm_execpath points to pnpm or another non-npm CLI", () => {
    expect(
      getDefaultSyncCommandArgv({
        platform: "linux",
        execPath: "/usr/local/bin/node",
        npmExecPath: "/home/me/.cache/node/corepack/v1/pnpm/9.15.0/bin/pnpm.cjs",
      }),
    ).toEqual([
      "npm",
      "exec",
      "--yes",
      "--package",
      "@blnayan/token-burn@latest",
      "--",
      "token-burn",
      "sync",
    ]);

    expect(
      getDefaultSyncCommandArgv({
        platform: "darwin",
        execPath: "/opt/homebrew/bin/node",
        npmExecPath: "/opt/homebrew/bin/yarn.js",
      }),
    ).toEqual([
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

  it("falls back to bare npm.cmd on Windows when npm_execpath points to pnpm", () => {
    expect(
      getDefaultSyncCommandArgv({
        platform: "win32",
        execPath: "C:\\Program Files\\nodejs\\node.exe",
        npmExecPath: "C:\\Users\\Me\\AppData\\Local\\pnpm\\pnpm.cjs",
      }),
    ).toEqual([
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

  it("prints generated scheduler content on dry run", async () => {
    const log = vi.fn();

    await runInstallScheduler({
      dryRun: true,
      platform: "linux",
      syncCommandArgv: [
        "/usr/local/bin/node",
        "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
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

    const output = log.mock.calls[0]?.[0] as string;
    expect(output).toContain("token-burn-sync.service");
    expect(output).toContain(
      "ExecStart=/usr/local/bin/node /usr/local/lib/node_modules/npm/bin/npm-cli.js exec --yes --package @blnayan/token-burn@latest -- token-burn sync",
    );
    expect(output).toContain("token-burn-sync.timer");
    expect(output).toContain("OnUnitActiveSec=15min");
    expect(output).toContain("# Cron fallback");
    expect(output).toContain(
      "*/15 * * * * '/usr/local/bin/node' '/usr/local/lib/node_modules/npm/bin/npm-cli.js' 'exec' '--yes' '--package' '@blnayan/token-burn@latest' '--' 'token-burn' 'sync' >> /tmp/token-burn-sync.log 2>&1",
    );
  });

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

    await runUninstallScheduler({ platform: "linux", uninstall, log });

    expect(uninstall).toHaveBeenCalledWith("linux");
    expect(log).toHaveBeenCalledWith("Removed Token Burn scheduler.");
  });
});

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

describe("doctor", () => {
  it("prints auth state, platform, and sync guidance", async () => {
    const log = vi.fn();

    await runDoctor({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
      platform: "linux",
      readHealth: async () => ({
        requiredCliVersion: cliVersion,
        serverTime: "2026-06-03T00:00:00.000Z",
      }),
      readDevices: async () => ({ duplicateGroups: [] }),
      log,
    });

    expect(log).toHaveBeenCalledWith("Authenticated with https://token-burn.test.");
    expect(log).toHaveBeenCalledWith("Platform: linux.");
    expect(log).toHaveBeenCalledWith("Run token-burn sync to submit usage now.");
  });
});
