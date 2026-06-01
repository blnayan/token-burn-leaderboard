import { describe, expect, it, vi } from "vitest";

import { runLogout } from "./logout.js";

describe("runLogout", () => {
  it("removes the token while preserving server URL and last sync", async () => {
    const writeConfig = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();

    await runLogout({
      readConfig: async () => ({
        serverUrl: "https://token-burn.test",
        token: "tb_secret",
        lastSync: {
          ok: true,
          message: "Synced 42 tokens",
          at: "2026-06-01T00:00:00.000Z",
        },
      }),
      writeConfig,
      log,
    });

    expect(writeConfig).toHaveBeenCalledWith({
      serverUrl: "https://token-burn.test",
      lastSync: {
        ok: true,
        message: "Synced 42 tokens",
        at: "2026-06-01T00:00:00.000Z",
      },
    });
    expect(log).toHaveBeenCalledWith("Logged out.");
  });

  it("reports not authenticated when no config exists", async () => {
    const writeConfig = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();

    await runLogout({
      readConfig: async () => null,
      writeConfig,
      log,
    });

    expect(writeConfig).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Not authenticated.");
  });
});
