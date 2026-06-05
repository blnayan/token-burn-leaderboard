import { Command } from "commander";

import { syncUsage, type SyncResult } from "../sync.js";
import { resolveOutputMode, type OutputFlags } from "../ui/mode.js";
import { createRenderer } from "../ui/renderer.js";
import type { UiRenderer } from "../ui/types.js";

export function renderSyncResult(result: SyncResult, ui: UiRenderer): void {
  if (result.failedProviders.length === 0) {
    ui.success("sync", result.lastSync.message);
  } else {
    ui.warning("sync", result.lastSync.message);
  }

  if (result.skippedProviders.length > 0) {
    ui.table("Skipped providers", {
      columns: ["Provider", "Reason"],
      rows: result.skippedProviders.map((issue) => [issue.provider, issue.message]),
    });
  }

  if (result.failedProviders.length > 0) {
    ui.table("Failed providers", {
      columns: ["Provider", "Reason"],
      rows: result.failedProviders.map((issue) => [issue.provider, issue.message]),
    });
  }

  ui.result({
    ok: result.failedProviders.length === 0,
    failedProviders: result.failedProviders,
    lastSync: result.lastSync,
    skippedProviders: result.skippedProviders,
    submitted: result.submitted,
    syncedAt: result.syncedAt,
  });
}

export function createSyncCommand(): Command {
  const command = new Command("sync").description("Sync ccusage totals to Token Burn").action(async () => {
    const flags = command.parent?.opts<OutputFlags>() ?? {};
    const ui = createRenderer(resolveOutputMode({ flags }));
    const result = await syncUsage({ log: () => undefined });
    renderSyncResult(result, ui);
  });

  return command;
}
