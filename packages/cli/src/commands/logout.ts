import { Command } from "commander";

import { deleteConfig } from "../config.js";

export async function runLogout(): Promise<void> {
  await deleteConfig();
  console.log("Logged out.");
}

export function createLogoutCommand(): Command {
  return new Command("logout").description("Remove local Token Burn CLI credentials").action(async () => {
    await runLogout();
  });
}
