import { describe, expect, it, vi } from "vitest";

import { runStatus } from "./status.js";

describe("runStatus", () => {
  it("prints logged-in server and last sync when present", async () => {
    const log = vi.fn();

    await runStatus({
      readConfig: async () => ({
        serverUrl: "https://token-burn.test",
        token: "tb_secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        lastSync: {
          ok: true,
          message: "Synced 42 tokens",
          at: "2026-06-01T00:00:00.000Z",
        },
      }),
      readHealth: async () => ({
        recommendedCliVersion: "0.1.6",
        minimumCliVersion: "0.1.5",
        serverTime: "2026-06-03T00:00:00.000Z",
      }),
      log,
    });

    expect(log).toHaveBeenCalledWith("CLI version: 0.1.5.");
    expect(log).toHaveBeenCalledWith("Authenticated with https://token-burn.test.");
    expect(log).toHaveBeenCalledWith("Device: nayan-vps (4f43b27d-7d86-4ff8-8c98-f74158819e59).");
    expect(log).toHaveBeenCalledWith("Last sync: OK - Synced 42 tokens at 2026-06-01T00:00:00.000Z.");
    expect(log).toHaveBeenCalledWith(
      "Update available: token-burn 0.1.5 -> 0.1.6. Run npm install -g @blnayan/token-burn@latest.",
    );
  });

  it("keeps local status useful when server health fails", async () => {
    const log = vi.fn();

    await runStatus({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "tb_secret" }),
      readHealth: async () => {
        throw new Error("network down");
      },
      log,
    });

    expect(log).toHaveBeenCalledWith("CLI version: 0.1.5.");
    expect(log).toHaveBeenCalledWith("Authenticated with https://token-burn.test.");
    expect(log).toHaveBeenCalledWith("Server health check failed: network down.");
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
