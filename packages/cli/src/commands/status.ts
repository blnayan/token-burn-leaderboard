import { Command } from "commander";

import type { CliConfig } from "../config.js";
import { readConfig as readConfigFile } from "../config.js";

export type StatusDependencies = {
  readConfig?: () => Promise<CliConfig | null>;
  log?: (message: string) => void;
};

export async function runStatus({
  readConfig = readConfigFile,
  log = console.log,
}: StatusDependencies = {}): Promise<void> {
  const config = await readConfig();

  if (!config) {
    log("Not authenticated.");
    return;
  }

  if (!config.token) {
    log("Not authenticated.");
    log(`Remembered server: ${config.serverUrl}.`);
  } else {
    log(`Authenticated with ${config.serverUrl}.`);
  }

  if (config.lastSync) {
    log(`Last sync: ${config.lastSync.ok ? "OK" : "Failed"} - ${config.lastSync.message} at ${config.lastSync.at}.`);
  }
}

export function createStatusCommand(): Command {
  return new Command("status").description("Show Token Burn CLI authentication status").action(async () => {
    await runStatus();
  });
}
