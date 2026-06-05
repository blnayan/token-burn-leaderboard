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

export type InstallSchedulerResult = {
  dryRun: boolean;
  output: string;
};

export type UninstallSchedulerResult = {
  output: string;
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
}: InstallSchedulerOptions): Promise<InstallSchedulerResult> {
  const renderer = ui ?? (log ? createLegacyLogRenderer(log) : createRenderer(resolveOutputMode({ flags: {} })));
  if (dryRun) {
    const result = { dryRun: true, output: buildSchedulerInstallOutput(platform, syncCommandArgv) };
    renderer.info(result.output);
    renderer.result({ ok: true, ...result });
    return result;
  }

  const result = { dryRun: false, output: await install(platform, syncCommandArgv) };
  renderer.success("scheduler", result.output);
  renderer.result({ ok: true, ...result });
  return result;
}

export async function runUninstallScheduler({
  platform = process.platform,
  uninstall = async (selectedPlatform) => uninstallScheduler({ runtime: createNodeSchedulerRuntime(selectedPlatform) }),
  log,
  ui,
}: UninstallSchedulerOptions = {}): Promise<UninstallSchedulerResult> {
  const renderer = ui ?? (log ? createLegacyLogRenderer(log) : createRenderer(resolveOutputMode({ flags: {} })));
  const result = { output: await uninstall(platform) };
  renderer.success("scheduler", result.output);
  renderer.result({ ok: true, ...result });
  return result;
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

function createLegacyLogRenderer(log: (message: string) => void): UiRenderer {
  return {
    ...createPlainRenderer({ write: log }),
    result() {},
  };
}
