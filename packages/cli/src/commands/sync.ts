import { Command } from "commander";

import { syncUsage } from "../sync.js";

export function createSyncCommand(): Command {
  return new Command("sync").description("Sync ccusage totals to Token Burn").action(async () => {
    await syncUsage();
  });
}
