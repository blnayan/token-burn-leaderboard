import { Command } from "commander";

import {
  buildSchedulerInstallOutput,
  createNodeSchedulerRuntime,
  installScheduler,
  type SchedulerCommandArgv,
  type SchedulerPlatform,
  uninstallScheduler,
} from "../scheduler.js";

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
  syncCommandArgv = getDefaultSyncCommandArgv({ platform }),
  install = async (selectedPlatform, selectedSyncCommandArgv) =>
    installScheduler({
      runtime: createNodeSchedulerRuntime(selectedPlatform),
      syncCommandArgv: selectedSyncCommandArgv,
    }),
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

export function createInstallSchedulerCommand(): Command {
  return new Command("install-scheduler")
    .description("Print scheduler setup guidance for automatic sync")
    .option("--dry-run", "Print the generated platform scheduler config or command")
    .action(async (options: { dryRun?: boolean }) => {
      await runInstallScheduler({ dryRun: options.dryRun === true });
    });
}

export function createUninstallSchedulerCommand(): Command {
  return new Command("uninstall-scheduler").description("Remove automatic Token Burn sync").action(async () => {
    await runUninstallScheduler();
  });
}

export function getDefaultSyncCommandArgv({
  platform = process.platform,
  execPath = process.execPath,
  npmExecPath = process.env.npm_execpath,
}: {
  platform?: SchedulerPlatform;
  execPath?: string;
  npmExecPath?: string;
} = {}): SchedulerCommandArgv {
  const npmCommand = platform === "win32" ? "npm.cmd" : "npm";
  const npmArgv = npmExecPath && isNpmCliPath(npmExecPath) ? [execPath, npmExecPath] : [npmCommand];

  return [
    ...npmArgv,
    "exec",
    "--yes",
    "--package",
    "@blnayan/token-burn@latest",
    "--",
    "token-burn",
    "sync",
  ];
}

function isNpmCliPath(value: string): boolean {
  return /(^|[\\/])npm-cli\.js$/i.test(value);
}
