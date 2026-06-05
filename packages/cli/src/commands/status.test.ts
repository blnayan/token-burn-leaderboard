import { describe, expect, it, vi } from "vitest";

import { cliVersion } from "../version.js";
import { runStatus } from "./status.js";

describe("runStatus", () => {
  it("prints logged-in server and last sync when present", async () => {
    const log = vi.fn();
    const serverRequiredCliVersion = createDifferentVersion(cliVersion);

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
        requiredCliVersion: serverRequiredCliVersion,
        serverTime: "2026-06-03T00:00:00.000Z",
      }),
      log,
    });

    expect(log).toHaveBeenCalledWith(`CLI version: ${cliVersion}.`);
    expect(log).toHaveBeenCalledWith("Authenticated with https://token-burn.test.");
    expect(log).toHaveBeenCalledWith("Device: nayan-vps (4f43b27d-7d86-4ff8-8c98-f74158819e59).");
    expect(log).toHaveBeenCalledWith("Last sync: OK - Synced 42 tokens at 2026-06-01T00:00:00.000Z.");
    expect(log).toHaveBeenCalledWith(
      `Token Burn requires token-burn ${serverRequiredCliVersion}. You have ${cliVersion}. Run npm install -g @blnayan/token-burn@latest.`,
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

    expect(log).toHaveBeenCalledWith(`CLI version: ${cliVersion}.`);
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

  it("reports tokenless last sync and returns it for renderers", async () => {
    const log = vi.fn();

    const result = await runStatus({
      readConfig: async () => ({
        serverUrl: "https://token-burn.test",
        lastSync: { ok: false, message: "Failed providers: claude_code", at: "2026-06-01T00:00:00.000Z" },
      }),
      log,
    });

    expect(log).toHaveBeenCalledWith("Not authenticated.");
    expect(log).toHaveBeenCalledWith("Remembered server: https://token-burn.test.");
    expect(log).toHaveBeenCalledWith(
      "Last sync: Failed - Failed providers: claude_code at 2026-06-01T00:00:00.000Z.",
    );
    expect(result).toEqual({
      authenticated: false,
      cliVersion,
      lastSync: { ok: false, message: "Failed providers: claude_code", at: "2026-06-01T00:00:00.000Z" },
      rememberedServer: "https://token-burn.test",
      serverUrl: "https://token-burn.test",
    });
  });

  it("returns structured status for renderers", async () => {
    const result = await runStatus({
      readConfig: async () => ({
        serverUrl: "https://token-burn.test",
        token: "tb_secret",
        deviceId: "device-1",
        deviceName: "nayan-vps",
        lastSync: { ok: true, message: "Submitted 42 usage rows.", at: "2026-06-01T00:00:00.000Z" },
      }),
      readHealth: async () => ({
        requiredCliVersion: cliVersion,
        serverTime: "2026-06-03T00:00:00.000Z",
      }),
      log: () => undefined,
    });

    expect(result).toEqual({
      authenticated: true,
      cliVersion,
      device: { id: "device-1", name: "nayan-vps" },
      lastSync: { ok: true, message: "Submitted 42 usage rows.", at: "2026-06-01T00:00:00.000Z" },
      rememberedServer: undefined,
      requiredCliVersion: cliVersion,
      serverHealthError: undefined,
      serverUrl: "https://token-burn.test",
    });
  });
});

function createDifferentVersion(version: string): string {
  const major = Number(version.split(".")[0] ?? 0);

  return `${major + 1}.0.0`;
}
