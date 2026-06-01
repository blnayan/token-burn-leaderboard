import { describe, expect, it, vi } from "vitest";

import { runStatus } from "./status.js";

describe("runStatus", () => {
  it("prints logged-in server and last sync when present", async () => {
    const log = vi.fn();

    await runStatus({
      readConfig: async () => ({
        serverUrl: "https://token-burn.test",
        token: "tb_secret",
        lastSync: {
          ok: true,
          message: "Synced 42 tokens",
          at: "2026-06-01T00:00:00.000Z",
        },
      }),
      log,
    });

    expect(log).toHaveBeenCalledWith("Authenticated with https://token-burn.test.");
    expect(log).toHaveBeenCalledWith("Last sync: OK - Synced 42 tokens at 2026-06-01T00:00:00.000Z.");
  });

  it("reports remembered server when config has no token", async () => {
    const log = vi.fn();

    await runStatus({
      readConfig: async () => ({ serverUrl: "https://token-burn.test" }),
      log,
    });

    expect(log).toHaveBeenCalledWith("Not authenticated.");
    expect(log).toHaveBeenCalledWith("Remembered server: https://token-burn.test.");
  });
});
