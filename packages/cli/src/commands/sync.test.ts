import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { syncUsage, type SyncResult } from "../sync.js";
import { createSyncCommand, renderSyncResult } from "./sync.js";

vi.mock("../sync.js", () => ({
  syncUsage: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderSyncResult", () => {
  it("renders provider tables when skips and failures exist", () => {
    const calls: string[] = [];
    const result: SyncResult = {
      failedProviders: [{ provider: "codex", message: "fixture missing" }],
      lastSync: { ok: false, message: "Submitted 1 usage row. Failed providers: codex: fixture missing.", at: "2026-06-01T00:00:00.000Z" },
      skippedProviders: [{ provider: "claude_code", message: "No valid Claude data directories found" }],
      submitted: 1,
      syncedAt: "2026-06-01T00:00:00.000Z",
    };

    renderSyncResult(result, {
      intro: () => undefined,
      step: () => undefined,
      success: () => undefined,
      warning: (_id, message) => calls.push(`warning:${message}`),
      info: () => undefined,
      table: (title) => calls.push(`table:${title}`),
      summary: () => undefined,
      nextAction: () => undefined,
      error: () => undefined,
      result: vi.fn(),
    });

    expect(calls).toEqual([
      "warning:Submitted 1 usage row. Failed providers: codex: fixture missing.",
      "table:Skipped providers",
      "table:Failed providers",
    ]);
  });

  it("honors parent --json output flags in the command action", async () => {
    const result: SyncResult = {
      failedProviders: [],
      lastSync: { ok: true, message: "Submitted 1 usage row.", at: "2026-06-01T00:00:00.000Z" },
      skippedProviders: [],
      submitted: 1,
      syncedAt: "2026-06-01T00:00:00.000Z",
    };
    vi.mocked(syncUsage).mockResolvedValue(result);
    const write = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const program = new Command()
      .name("token-burn")
      .option("--json")
      .exitOverride();
    program.addCommand(createSyncCommand());

    await program.parseAsync(["--json", "sync"], { from: "user" });

    expect(syncUsage).toHaveBeenCalledWith({ log: expect.any(Function) });
    expect(write.mock.calls).toEqual([[JSON.stringify({ ok: true, ...result })]]);
  });
});
