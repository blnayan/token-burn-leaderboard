#!/usr/bin/env node
import { Command } from "commander";

import { createDevicesCommand } from "./commands/devices.js";
import { createDoctorCommand } from "./commands/doctor.js";
import { createLoginCommand } from "./commands/login.js";
import { createLogoutCommand } from "./commands/logout.js";
import { createInstallSchedulerCommand, createUninstallSchedulerCommand } from "./commands/scheduler.js";
import { createSyncCommand } from "./commands/sync.js";
import { createStatusCommand } from "./commands/status.js";

const program = new Command()
  .name("token-burn")
  .description("Token Burn command line tools")
  .version("0.1.4");

program.addCommand(createLoginCommand());
program.addCommand(createLogoutCommand());
program.addCommand(createStatusCommand());
program.addCommand(createSyncCommand());
program.addCommand(createDevicesCommand());
program.addCommand(createDoctorCommand());
program.addCommand(createInstallSchedulerCommand());
program.addCommand(createUninstallSchedulerCommand());

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(message);
  process.exitCode = 1;
});
