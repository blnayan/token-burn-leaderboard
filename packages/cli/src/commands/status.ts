import { Command } from "commander";

import { readConfig } from "../config.js";

export async function runStatus(): Promise<void> {
  const config = await readConfig();

  if (!config) {
    console.log("Not authenticated.");
    return;
  }

  console.log(`Authenticated with ${config.serverUrl}.`);
}

export function createStatusCommand(): Command {
  return new Command("status").description("Show Token Burn CLI authentication status").action(async () => {
    await runStatus();
  });
}
