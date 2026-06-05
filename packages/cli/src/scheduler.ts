import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { promisify } from "node:util";

export type SchedulerPlatform = NodeJS.Platform;
export type SchedulerCommandArgv = readonly [string, ...string[]];
export type SchedulerRuntime = {
  platform: SchedulerPlatform;
  homeDir: string;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  rm(path: string): Promise<void>;
  execFile(command: string, args: string[]): Promise<string>;
  execFileWithInput(command: string, args: string[], input: string): Promise<void>;
};

const cronLogPath = "/tmp/token-burn-sync.log";
const cronStartMarker = "# BEGIN Token Burn scheduler";
const cronEndMarker = "# END Token Burn scheduler";
const launchdLabel = "com.token-burn.sync";
const windowsTaskName = "TokenBurnSync";
const execFileAsync = promisify(execFileCallback);

export function buildCronLine(commandArgv: SchedulerCommandArgv): string {
  return `*/15 * * * * ${commandArgv.map(shellQuote).join(" ")} >> ${cronLogPath} 2>&1`;
}

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

export function buildCronBlock(commandArgv: SchedulerCommandArgv): string {
  return [cronStartMarker, buildCronLine(commandArgv), cronEndMarker].join("\n");
}

export function mergeCronBlock(existingCrontab: string, block: string): string {
  const markerPattern = cronMarkerPattern();
  let replaced = false;
  const withFreshBlock = existingCrontab.replace(markerPattern, () => {
    if (replaced) return "";
    replaced = true;
    return `${block}\n`;
  });

  if (replaced) {
    return ensureTrailingNewline(withFreshBlock.trimEnd());
  }

  const trimmed = existingCrontab.trimEnd();
  return `${trimmed ? `${trimmed}\n` : ""}${block}\n`;
}

export function removeCronBlock(existingCrontab: string): string {
  const withoutExisting = existingCrontab.replace(cronMarkerPattern(), "").trimEnd();
  return withoutExisting ? `${withoutExisting}\n` : "";
}

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

export function buildWindowsTaskCommand(commandArgv: SchedulerCommandArgv): string {
  return `schtasks ${buildWindowsTaskArgs(commandArgv).map(windowsQuoteIfNeeded).join(" ")}`;
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
    "/ST",
    "00:00",
    "/TR",
    commandArgv.map(windowsQuoteIfNeeded).join(" "),
    "/F",
  ];
}

export function buildSchedulerInstallOutput(platform: SchedulerPlatform, commandArgv: SchedulerCommandArgv): string {
  if (platform === "darwin") return buildLaunchdPlist(commandArgv);
  if (platform === "win32") return buildWindowsTaskCommand(commandArgv);
  return [
    "# ~/.config/systemd/user/token-burn-sync.service",
    buildSystemdService(commandArgv).trimEnd(),
    "",
    "# ~/.config/systemd/user/token-burn-sync.timer",
    buildSystemdTimer().trimEnd(),
    "",
    "# Cron fallback",
    buildCronBlock(commandArgv),
  ].join("\n");
}

export async function installScheduler({
  runtime,
  syncCommandArgv,
}: {
  runtime: SchedulerRuntime;
  syncCommandArgv: SchedulerCommandArgv;
}): Promise<string> {
  if (runtime.platform === "linux") return installLinuxScheduler(runtime, syncCommandArgv);
  if (runtime.platform === "darwin") return installMacScheduler(runtime, syncCommandArgv);
  if (runtime.platform === "win32") return installWindowsScheduler(runtime, syncCommandArgv);
  throw new Error(`Unsupported scheduler platform: ${runtime.platform}`);
}

export async function uninstallScheduler({ runtime }: { runtime: SchedulerRuntime }): Promise<string> {
  if (runtime.platform === "linux") return uninstallLinuxScheduler(runtime);
  if (runtime.platform === "darwin") return uninstallMacScheduler(runtime);
  if (runtime.platform === "win32") return uninstallWindowsScheduler(runtime);
  throw new Error(`Unsupported scheduler platform: ${runtime.platform}`);
}

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
      await spawnWithInput(command, args, input);
    },
  };
}

async function installLinuxScheduler(runtime: SchedulerRuntime, syncCommandArgv: SchedulerCommandArgv): Promise<string> {
  try {
    await installLinuxSystemdScheduler(runtime, syncCommandArgv);
  } catch (error) {
    await installLinuxCronScheduler(runtime, syncCommandArgv);
    return `Installed Token Burn cron entry after systemd user timer was unavailable: ${errorMessage(error)}`;
  }

  try {
    await removeLinuxCronFallbackIfPresent(runtime);
    return "Installed Token Burn systemd user timer token-burn-sync.timer.";
  } catch (error) {
    return `Installed Token Burn systemd user timer token-burn-sync.timer, but existing cron fallback could not be removed: ${errorMessage(error)}`;
  }
}

async function installLinuxSystemdScheduler(
  runtime: SchedulerRuntime,
  syncCommandArgv: SchedulerCommandArgv,
): Promise<void> {
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

async function removeLinuxCronFallbackIfPresent(runtime: SchedulerRuntime): Promise<void> {
  const existing = await runtime.execFile("crontab", ["-l"]).catch(() => "");
  if (!hasCronBlock(existing)) return;

  const cleaned = removeCronBlock(existing);

  if (cleaned === existing || cleaned === ensureTrailingNewline(existing)) return;

  await runtime.execFileWithInput("crontab", ["-"], cleaned);
}

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

async function spawnWithInput(command: string, args: string[], input: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
    child.stdin.end(input);
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function systemdEscapeArg(value: string): string {
  if (!/[\s"\\]/.test(value)) return value;
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function windowsQuoteIfNeeded(value: string): string {
  if (!/[\s"]/.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cronMarkerPattern(): RegExp {
  return new RegExp(`${escapeRegExp(cronStartMarker)}[\\s\\S]*?${escapeRegExp(cronEndMarker)}\\n?`, "gm");
}

function hasCronBlock(existingCrontab: string): boolean {
  return cronMarkerPattern().test(existingCrontab);
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
