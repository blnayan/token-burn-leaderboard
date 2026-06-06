import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  createNodeSchedulerRuntime,
  installScheduler,
  type SchedulerCommandArgv,
  uninstallScheduler,
} from "../packages/cli/src/scheduler.js";

const execFile = promisify(execFileCallback);
const launchdLabel = "com.token-burn.sync";
const windowsTaskName = "TokenBurnSync";
const cronStartMarker = "# BEGIN Token Burn scheduler";
const cronEndMarker = "# END Token Burn scheduler";

const workspace = join(tmpdir(), `token-burn-scheduler-smoke-${process.pid}`);
const sentinelPath = join(workspace, "scheduler-fired.txt");
const writerPath = join(workspace, "write-sentinel.mjs");

async function main() {
  await mkdir(workspace, { recursive: true });
  await writeFile(
    writerPath,
    [
      'import { writeFileSync } from "node:fs";',
      'writeFileSync(process.argv[2], `scheduler fired at ${new Date().toISOString()}\\n`, "utf8");',
      "",
    ].join("\n"),
    "utf8",
  );

  const runtime = createNodeSchedulerRuntime(platform());
  const commandArgv: SchedulerCommandArgv =
    platform() === "darwin"
      ? ["node", writerPath, sentinelPath]
      : [process.execPath, writerPath, sentinelPath];

  try {
    const installMessage = await installScheduler({
      runtime,
      syncCommandArgv: commandArgv,
    });
    console.log(installMessage);

    assertExpectedInstallPath(installMessage);
    await assertSchedulerRegistered(installMessage);
    await forceRunScheduler(installMessage);
    await waitForSentinel();
  } finally {
    await uninstallScheduler({ runtime }).catch((error) => {
      console.error(`Scheduler cleanup failed: ${formatError(error)}`);
    });
    await assertSchedulerRemoved().catch((error) => {
      console.error(
        `Scheduler removal verification failed: ${formatError(error)}`,
      );
      throw error;
    });
    await rm(workspace, { recursive: true, force: true });
  }

  console.log(`Real ${platform()} scheduler smoke passed.`);
}

function assertExpectedInstallPath(installMessage: string) {
  if (
    platform() !== "linux" ||
    process.env.TOKEN_BURN_SCHEDULER_SMOKE_REQUIRE_SYSTEMD !== "1"
  )
    return;

  assertIncludes(
    installMessage,
    "systemd user timer",
    "Linux scheduler smoke should exercise the preferred systemd user timer path",
  );
}

async function assertSchedulerRegistered(installMessage: string) {
  if (platform() === "darwin") {
    const plistPath = join(
      homedir(),
      "Library",
      "LaunchAgents",
      `${launchdLabel}.plist`,
    );
    const plist = await readFile(plistPath, "utf8");

    assertIncludes(
      plist,
      "<key>EnvironmentVariables</key>",
      "launchd plist should include environment variables",
    );
    assertIncludes(
      plist,
      "<key>PATH</key>",
      "launchd plist should include PATH",
    );
    assertIncludes(
      plist,
      "<string>/usr/bin/env</string>",
      "launchd plist should run relative commands through env",
    );

    await execFile("launchctl", ["list", launchdLabel]);
    return;
  }

  if (platform() === "win32") {
    const { stdout } = await execFile("schtasks", [
      "/Query",
      "/TN",
      windowsTaskName,
    ]);
    assertIncludes(
      stdout,
      windowsTaskName,
      "Windows scheduled task should be queryable after install",
    );
    return;
  }

  if (installMessage.includes("systemd user timer")) {
    const { stdout } = await execFile("systemctl", [
      "--user",
      "is-enabled",
      "token-burn-sync.timer",
    ]);
    assertIncludes(
      stdout,
      "enabled",
      "systemd timer should be enabled after install",
    );
    return;
  }

  const { stdout } = await execFile("crontab", ["-l"]);
  assertIncludes(
    stdout,
    cronStartMarker,
    "cron fallback should include Token Burn start marker",
  );
  assertIncludes(
    stdout,
    cronEndMarker,
    "cron fallback should include Token Burn end marker",
  );
  assertIncludes(
    stdout,
    writerPath,
    "cron fallback should include the sentinel writer command",
  );
}

async function forceRunScheduler(installMessage: string) {
  if (platform() === "darwin") {
    const uid = process.getuid?.();
    if (uid !== undefined) {
      const domainLabel = `gui/${uid}/${launchdLabel}`;
      const kicked = await tryExecFile("launchctl", [
        "kickstart",
        "-k",
        domainLabel,
      ]);
      if (kicked.ok) return;
      console.log(
        `launchctl kickstart failed, falling back to start: ${kicked.error}`,
      );
    }

    await execFile("launchctl", ["start", launchdLabel]);
    return;
  }

  if (platform() === "win32") {
    await execFile("schtasks", ["/Run", "/TN", windowsTaskName]);
    return;
  }

  if (installMessage.includes("systemd user timer")) {
    await execFile("systemctl", ["--user", "start", "token-burn-sync.service"]);
    return;
  }

  const { stdout } = await execFile("crontab", ["-l"]);
  const command = extractCronCommand(stdout);
  await execFile("bash", ["-lc", command]);
}

async function waitForSentinel() {
  const deadline = Date.now() + 30_000;
  let lastError = "";

  while (Date.now() < deadline) {
    if (existsSync(sentinelPath)) {
      const content = await readFile(sentinelPath, "utf8");
      assertIncludes(
        content,
        "scheduler fired at",
        "sentinel should contain scheduler timestamp",
      );
      console.log(content.trim());
      return;
    }

    await sleep(500);
  }

  if (platform() === "darwin") {
    const log = await tryExecFile("tail", ["-100", "/tmp/token-burn-sync.log"]);
    lastError = log.ok ? log.stdout : log.error;
  }

  throw new Error(
    `Scheduler did not create sentinel at ${sentinelPath}.${lastError ? ` Logs: ${lastError}` : ""}`,
  );
}

async function assertSchedulerRemoved() {
  if (platform() === "darwin") {
    const plistPath = join(
      homedir(),
      "Library",
      "LaunchAgents",
      `${launchdLabel}.plist`,
    );
    if (existsSync(plistPath))
      throw new Error(
        `launchd plist still exists after uninstall: ${plistPath}`,
      );
    return;
  }

  if (platform() === "win32") {
    const result = await tryExecFile("schtasks", [
      "/Query",
      "/TN",
      windowsTaskName,
    ]);
    if (result.ok)
      throw new Error("Windows scheduled task still exists after uninstall");
    return;
  }

  const crontab = await tryExecFile("crontab", ["-l"]);
  if (crontab.ok && crontab.stdout.includes(cronStartMarker)) {
    throw new Error("Token Burn cron block still exists after uninstall");
  }
}

function extractCronCommand(crontab: string): string {
  const lines = crontab.split(/\r?\n/);
  const start = lines.indexOf(cronStartMarker);
  const end = lines.indexOf(cronEndMarker);
  if (start === -1 || end === -1 || end <= start + 1) {
    throw new Error("Could not find Token Burn cron block to force-run");
  }

  const cronLine = lines
    .slice(start + 1, end)
    .find((line) => line.trim() !== "");
  const match = cronLine?.match(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/);
  if (!match)
    throw new Error(
      `Could not parse Token Burn cron line: ${cronLine ?? "<missing>"}`,
    );

  return match[1];
}

async function tryExecFile(command: string, args: string[]) {
  try {
    const { stdout, stderr } = await execFile(command, args);
    return { ok: true as const, stdout, stderr };
  } catch (error) {
    return { ok: false as const, error: formatError(error) };
  }
}

function assertIncludes(value: string, expected: string, message: string) {
  if (!value.includes(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(value)} to include ${JSON.stringify(expected)}`,
    );
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

main().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
