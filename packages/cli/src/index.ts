#!/usr/bin/env node
import { Command } from "commander";

import { createLoginCommand } from "./commands/login.js";
import { createLogoutCommand } from "./commands/logout.js";
import { createSyncCommand } from "./commands/sync.js";
import { createStatusCommand } from "./commands/status.js";

const program = new Command()
  .name("token-burn")
  .description("Token Burn command line tools")
  .version("0.1.0");

program.addCommand(createLoginCommand());
program.addCommand(createLogoutCommand());
program.addCommand(createStatusCommand());
program.addCommand(createSyncCommand());

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(message);
  process.exitCode = 1;
});
