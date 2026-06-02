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
  const markerPattern = new RegExp(
    `${escapeRegExp(cronStartMarker)}[\\s\\S]*?${escapeRegExp(cronEndMarker)}\\n?`,
    "m",
  );
  if (markerPattern.test(existingCrontab)) {
    return ensureTrailingNewline(existingCrontab.replace(markerPattern, `${block}\n`));
  }

  const trimmed = existingCrontab.trimEnd();
  return `${trimmed ? `${trimmed}\n` : ""}${block}\n`;
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
  <key>StartInterval</key>
  <integer>900</integer>
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
    "/TR",
    commandArgv.map(windowsQuoteIfNeeded).join(" "),
    "/F",
  ];
}

export function buildSchedulerInstallOutput(platform: SchedulerPlatform, commandArgv: SchedulerCommandArgv): string {
  if (platform === "darwin") return buildLaunchdPlist(commandArgv);
  if (platform === "win32") return buildWindowsTaskCommand(commandArgv);
  return buildCronLine(commandArgv);
}

export function buildSchedulerInstallGuidance(platform: SchedulerPlatform): string {
  if (platform === "darwin") {
    return "Run token-burn install-scheduler --dry-run, review the generated launchd plist, then save it to ~/Library/LaunchAgents/com.token-burn.sync.plist and load it with launchctl.";
  }

  if (platform === "win32") {
    return "Run token-burn install-scheduler --dry-run, review the generated schtasks command, then run it in an elevated shell.";
  }

  return "Run token-burn install-scheduler --dry-run, review the generated cron entry, then install it with crontab.";
}

export function buildSchedulerUninstallGuidance(platform: SchedulerPlatform): string {
  if (platform === "darwin") {
    return "Remove ~/Library/LaunchAgents/com.token-burn.sync.plist, then run launchctl unload on that plist if it is loaded.";
  }

  if (platform === "win32") {
    return "Remove the scheduled task with: schtasks /Delete /TN TokenBurnSync /F";
  }

  return "Remove the token-burn sync entry from your crontab.";
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

async function installLinuxScheduler(runtime: SchedulerRuntime, syncCommandArgv: SchedulerCommandArgv): Promise<string> {
  try {
    await installLinuxSystemdScheduler(runtime, syncCommandArgv);
    return "Installed Token Burn systemd user timer token-burn-sync.timer.";
  } catch (error) {
    await installLinuxCronScheduler(runtime, syncCommandArgv);
    const message = error instanceof Error ? error.message : String(error);
    return `Installed Token Burn cron entry after systemd user timer was unavailable: ${message}`;
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

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
