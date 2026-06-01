export type SchedulerPlatform = NodeJS.Platform;

const cronLogPath = "/tmp/token-burn-sync.log";
const launchdLabel = "com.token-burn.sync";
const windowsTaskName = "TokenBurnSync";

export function buildCronLine(binaryPath: string): string {
  return `*/15 * * * * ${shellQuoteIfNeeded(binaryPath)} sync >> ${cronLogPath} 2>&1`;
}

export function buildLaunchdPlist(binaryPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(launchdLabel)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(binaryPath)}</string>
    <string>sync</string>
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

export function buildWindowsTaskCommand(binaryPath: string): string {
  return `schtasks /Create /TN ${windowsTaskName} /SC MINUTE /MO 15 /TR "\\"${binaryPath}\\" sync" /F`;
}

export function buildSchedulerInstallOutput(platform: SchedulerPlatform, binaryPath: string): string {
  if (platform === "darwin") return buildLaunchdPlist(binaryPath);
  if (platform === "win32") return buildWindowsTaskCommand(binaryPath);
  return buildCronLine(binaryPath);
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

function shellQuoteIfNeeded(value: string): string {
  if (!/[\s'"\\$`!]/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
