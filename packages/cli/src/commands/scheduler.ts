import { Command } from "commander";

import {
  buildSchedulerInstallGuidance,
  buildSchedulerInstallOutput,
  type SchedulerCommandArgv,
  buildSchedulerUninstallGuidance,
  type SchedulerPlatform,
} from "../scheduler.js";

export type InstallSchedulerOptions = {
  dryRun: boolean;
  platform?: SchedulerPlatform;
  syncCommandArgv?: SchedulerCommandArgv;
  log?: (message: string) => void;
};

export type UninstallSchedulerOptions = {
  platform?: SchedulerPlatform;
  log?: (message: string) => void;
};

export function runInstallScheduler({
  dryRun,
  platform = process.platform,
  syncCommandArgv = getDefaultSyncCommandArgv(),
  log = console.log,
}: InstallSchedulerOptions): void {
  if (dryRun) {
    log(buildSchedulerInstallOutput(platform, syncCommandArgv));
    return;
  }

  log(buildSchedulerInstallGuidance(platform));
}

export function runUninstallScheduler({
  platform = process.platform,
  log = console.log,
}: UninstallSchedulerOptions = {}): void {
  log(buildSchedulerUninstallGuidance(platform));
}

export function createInstallSchedulerCommand(): Command {
  return new Command("install-scheduler")
    .description("Print scheduler setup guidance for automatic sync")
    .option("--dry-run", "Print the generated platform scheduler config or command")
    .action((options: { dryRun?: boolean }) => {
      runInstallScheduler({ dryRun: options.dryRun === true });
    });
}

export function createUninstallSchedulerCommand(): Command {
  return new Command("uninstall-scheduler").description("Print scheduler removal guidance").action(() => {
    runUninstallScheduler();
  });
}

export function getDefaultSyncCommandArgv({
  argv = process.argv,
  execPath = process.execPath,
}: {
  argv?: readonly string[];
  execPath?: string;
} = {}): SchedulerCommandArgv {
  const cliEntrypoint = argv[1];
  if (!cliEntrypoint) return ["token-burn", "sync"];

  return [execPath, cliEntrypoint, "sync"];
}
