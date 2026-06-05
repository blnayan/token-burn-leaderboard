#!/usr/bin/env node
import { Command } from "commander";
import { pathToFileURL } from "node:url";

import { createDevicesCommand } from "./commands/devices.js";
import { createDoctorCommand } from "./commands/doctor.js";
import { createLoginCommand } from "./commands/login.js";
import { createLogoutCommand } from "./commands/logout.js";
import {
  createInstallSchedulerCommand,
  createSchedulerCommand,
  createUninstallSchedulerCommand,
} from "./commands/scheduler.js";
import { createSetupCommand } from "./commands/setup.js";
import { createSyncCommand } from "./commands/sync.js";
import { createStatusCommand } from "./commands/status.js";
import { resolveOutputMode, type OutputFlags } from "./ui/mode.js";
import { createRenderer } from "./ui/renderer.js";
import { cliVersion } from "./version.js";

export function createProgram(): Command {
  const program = new Command()
    .name("token-burn")
    .description("Token Burn command line tools")
    .version(cliVersion)
    .option("--plain", "Force plain, log-safe output")
    .option("--json", "Emit machine-readable JSON where supported")
    .option("--no-color", "Disable ANSI color")
    .option("--quiet", "Suppress nonessential output");

  program.addCommand(createSetupCommand());
  program.addCommand(createLoginCommand());
  program.addCommand(createLogoutCommand());
  program.addCommand(createStatusCommand());
  program.addCommand(createSyncCommand());
  program.addCommand(createDevicesCommand());
  program.addCommand(createDoctorCommand());
  program.addCommand(createSchedulerCommand());
  program.addCommand(createInstallSchedulerCommand());
  program.addCommand(createUninstallSchedulerCommand());

  return program;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const program = createProgram();

  program.parseAsync().catch((error: unknown) => {
    const flags = program.opts<OutputFlags>();
    const outputMode = resolveOutputMode({ flags });
    const ui = createRenderer(outputMode, { write: console.error });
    const message = error instanceof Error ? error.message : String(error);

    ui.error({ code: "CLI_ERROR", message });
    process.exitCode = 1;
  });
}
