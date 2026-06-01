import { Command } from "commander";

import type { CliConfig } from "../config.js";
import { readConfig as readConfigFile } from "../config.js";
import type { SchedulerPlatform } from "../scheduler.js";

export type DoctorDependencies = {
  readConfig?: () => Promise<CliConfig | null>;
  platform?: SchedulerPlatform;
  log?: (message: string) => void;
};

export async function runDoctor({
  readConfig = readConfigFile,
  platform = process.platform,
  log = console.log,
}: DoctorDependencies = {}): Promise<void> {
  const config = await readConfig();

  if (config?.token) {
    log(`Authenticated with ${config.serverUrl}.`);
  } else {
    log("Not authenticated.");
    if (config?.serverUrl) {
      log(`Remembered server: ${config.serverUrl}.`);
    }
  }

  log(`Platform: ${platform}.`);
  log("Run token-burn sync to submit usage now.");
}

export function createDoctorCommand(): Command {
  return new Command("doctor").description("Check Token Burn CLI setup").action(async () => {
    await runDoctor();
  });
}
