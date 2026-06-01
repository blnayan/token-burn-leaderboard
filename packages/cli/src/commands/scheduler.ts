import { Command } from "commander";

import {
  buildSchedulerInstallGuidance,
  buildSchedulerInstallOutput,
  buildSchedulerUninstallGuidance,
  type SchedulerPlatform,
} from "../scheduler.js";

export type InstallSchedulerOptions = {
  dryRun: boolean;
  platform?: SchedulerPlatform;
  binaryPath?: string;
  log?: (message: string) => void;
};

export type UninstallSchedulerOptions = {
  platform?: SchedulerPlatform;
  log?: (message: string) => void;
};

export function runInstallScheduler({
  dryRun,
  platform = process.platform,
  binaryPath = getDefaultBinaryPath(),
  log = console.log,
}: InstallSchedulerOptions): void {
  if (dryRun) {
    log(buildSchedulerInstallOutput(platform, binaryPath));
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

function getDefaultBinaryPath(): string {
  return process.argv[1] ?? "token-burn";
}
