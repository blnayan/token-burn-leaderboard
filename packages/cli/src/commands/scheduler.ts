import { Command } from "commander";

import {
  buildSchedulerInstallOutput,
  createNodeSchedulerRuntime,
  installScheduler,
  type SchedulerCommandArgv,
  type SchedulerPlatform,
  uninstallScheduler,
} from "../scheduler.js";
import { resolveOutputMode, type OutputFlags } from "../ui/mode.js";
import { createPlainRenderer } from "../ui/plain-renderer.js";
import { createRenderer } from "../ui/renderer.js";
import type { UiRenderer } from "../ui/types.js";

export type InstallSchedulerOptions = {
  dryRun: boolean;
  platform?: SchedulerPlatform;
  syncCommandArgv?: SchedulerCommandArgv;
  install?: (platform: SchedulerPlatform, syncCommandArgv: SchedulerCommandArgv) => Promise<string>;
  log?: (message: string) => void;
  ui?: UiRenderer;
};

export type UninstallSchedulerOptions = {
  platform?: SchedulerPlatform;
  uninstall?: (platform: SchedulerPlatform) => Promise<string>;
  log?: (message: string) => void;
  ui?: UiRenderer;
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
  log,
  ui,
}: InstallSchedulerOptions): Promise<void> {
  const renderer = ui ?? (log ? createPlainRenderer({ write: log }) : createRenderer(resolveOutputMode({ flags: {} })));
  if (dryRun) {
    renderer.info(buildSchedulerInstallOutput(platform, syncCommandArgv));
    return;
  }

  renderer.success("scheduler", await install(platform, syncCommandArgv));
}

export async function runUninstallScheduler({
  platform = process.platform,
  uninstall = async (selectedPlatform) => uninstallScheduler({ runtime: createNodeSchedulerRuntime(selectedPlatform) }),
  log,
  ui,
}: UninstallSchedulerOptions = {}): Promise<void> {
  const renderer = ui ?? (log ? createPlainRenderer({ write: log }) : createRenderer(resolveOutputMode({ flags: {} })));
  renderer.success("scheduler", await uninstall(platform));
}

export function createInstallSchedulerCommand(): Command {
  const command = new Command("install-scheduler")
    .description("Print scheduler setup guidance for automatic sync")
    .option("--dry-run", "Print the generated platform scheduler config or command")
    .action(async (options: { dryRun?: boolean }) => {
      const flags = command.parent?.opts<OutputFlags>() ?? {};
      await runInstallScheduler({ dryRun: options.dryRun === true, ui: createRenderer(resolveOutputMode({ flags })) });
    });

  return command;
}

export function createUninstallSchedulerCommand(): Command {
  const command = new Command("uninstall-scheduler").description("Remove automatic Token Burn sync").action(async () => {
    const flags = command.parent?.opts<OutputFlags>() ?? {};
    await runUninstallScheduler({ ui: createRenderer(resolveOutputMode({ flags })) });
  });

  return command;
}

export function createSchedulerCommand(): Command {
  const command = new Command("scheduler").description("Manage automatic Token Burn sync");

  command
    .command("install")
    .description("Install automatic Token Burn sync")
    .option("--dry-run", "Print the generated platform scheduler config or command")
    .action(async (options: { dryRun?: boolean }) => {
      const flags = command.parent?.opts<OutputFlags>() ?? {};
      await runInstallScheduler({ dryRun: options.dryRun === true, ui: createRenderer(resolveOutputMode({ flags })) });
    });

  command.command("uninstall").description("Remove automatic Token Burn sync").action(async () => {
    const flags = command.parent?.opts<OutputFlags>() ?? {};
    await runUninstallScheduler({ ui: createRenderer(resolveOutputMode({ flags })) });
  });

  return command;
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

  if (npmExecPath && isNpmCliPath(npmExecPath)) {
    return [
      execPath,
      npmExecPath,
      "exec",
      "--yes",
      "--package",
      "@blnayan/token-burn@latest",
      "--",
      "token-burn",
      "sync",
    ];
  }

  return [npmCommand, "exec", "--yes", "--package", "@blnayan/token-burn@latest", "--", "token-burn", "sync"];
}

function isNpmCliPath(value: string): boolean {
  return /(^|[\\/])npm-cli\.js$/i.test(value);
}
