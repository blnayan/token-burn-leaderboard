import { Command } from "commander";

import type { CliConfig } from "../config.js";
import { readConfig as readConfigFile, writeConfig as writeConfigFile } from "../config.js";

export type LogoutDependencies = {
  readConfig?: () => Promise<CliConfig | null>;
  writeConfig?: (config: CliConfig) => Promise<void>;
  log?: (message: string) => void;
};

export async function runLogout({
  readConfig = readConfigFile,
  writeConfig = writeConfigFile,
  log = console.log,
}: LogoutDependencies = {}): Promise<void> {
  const config = await readConfig();

  if (!config) {
    log("Not authenticated.");
    return;
  }

  const loggedOutConfig: CliConfig = {
    serverUrl: config.serverUrl,
    ...(config.lastSync ? { lastSync: config.lastSync } : {}),
  };

  await writeConfig(loggedOutConfig);
  log("Logged out.");
}

export function createLogoutCommand(): Command {
  return new Command("logout").description("Remove local Token Burn CLI credentials").action(async () => {
    await runLogout();
  });
}
