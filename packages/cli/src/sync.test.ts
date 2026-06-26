import { describe, expect, it } from "vitest";

import type { SyncWindowsResponse } from "@token-burn/shared";

import type { CliConfig } from "./config.js";
import type { TokenBurnServerClient } from "./server-client.js";
import { syncUsage } from "./sync.js";
import type { SyncCollectionOptions } from "./sync-collection.js";
import { cliVersion as currentCliVersion } from "./version.js";

type SyncServerClient = Pick<TokenBurnServerClient, "readHealth" | "readSyncWindows" | "submitSyncPayload">;

describe("syncUsage", () => {
  it("throws a helpful login message when no token is configured", async () => {
    await expect(
      syncUsage({
        readConfig: async () => ({ serverUrl: "https://token-burn.test" }),
      }),
    ).rejects.toThrow("Run token-burn login --server-url https://token-burn.test to authenticate.");
  });

  it("uses the production server in the login message when no config exists", async () => {
    await expect(
      syncUsage({
        readConfig: async () => null,
      }),
    ).rejects.toThrow("Run token-burn login --server-url https://tokenburn.nayanbhut.dev to authenticate.");
  });

  it("posts payloads and writes successful lastSync after a successful sync", async () => {
    const writes: CliConfig[] = [];
    const logs: string[] = [];

    await syncUsage({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
      writeConfig: async (config) => {
        writes.push(config);
      },
      serverClient: matchingServerClient(),
      collectAndSubmitUsage: async () => ({
        submitted: 2,
        failedProviders: [],
        skippedProviders: [],
      }),
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      platform: "linux",
      cliVersion: "0.1.0",
      createDeviceId: () => "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      readDeviceName: () => "nayan-vps",
      log: (message) => {
        logs.push(message);
      },
    });

    expect(writes).toEqual([
      {
        serverUrl: "https://token-burn.test",
        token: "secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
      },
      {
        serverUrl: "https://token-burn.test",
        token: "secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        lastSync: {
          ok: true,
          message: "Submitted 2 usage rows.",
          at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);
    expect(logs).toEqual(["Submitted 2 usage rows."]);
  });

  it("returns structured sync results after a successful sync", async () => {
    const result = await syncUsage({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
      writeConfig: async () => {},
      serverClient: matchingServerClient(),
      collectAndSubmitUsage: async () => ({
        submitted: 1,
        failedProviders: [],
        skippedProviders: [],
      }),
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      platform: "linux",
      cliVersion: "0.1.0",
      createDeviceId: () => "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      readDeviceName: () => "nayan-vps",
      log: () => {},
    });

    expect(result).toEqual({
      failedProviders: [],
      lastSync: {
        ok: true,
        message: "Submitted 1 usage row.",
        at: "2026-06-01T00:00:00.000Z",
      },
      skippedProviders: [],
      submitted: 1,
      syncedAt: "2026-06-01T00:00:00.000Z",
    });
  });

  it("fetches server sync windows and passes them to collection", async () => {
    const readSyncWindowsCalls: Array<{ token: string; deviceId: string }> = [];
    const collectionCalls: SyncCollectionOptions[] = [];

    await syncUsage({
      readConfig: async () => ({
        serverUrl: "https://token-burn.test",
        token: "secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      }),
      writeConfig: async () => {},
      serverClient: matchingServerClient({
        readSyncWindows: async (options) => {
          readSyncWindowsCalls.push(options);
          return {
            serverTime: "2026-06-06T12:00:00.000Z",
            until: "2026-06-06",
            providers: [
              { provider: "claude_code", since: "2026-06-05" },
              { provider: "codex", since: "2026-06-06" },
            ],
          };
        },
      }),
      collectAndSubmitUsage: async (options) => {
        collectionCalls.push(options);
        return { submitted: 2, failedProviders: [], skippedProviders: [] };
      },
      now: () => new Date("2026-06-06T12:30:00.000Z"),
      platform: "linux",
      cliVersion: "0.1.0",
      readDeviceName: () => "nayan-vps",
      log: () => {},
    });

    expect(readSyncWindowsCalls).toEqual([
      { token: "secret", deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59" },
    ]);
    expect(collectionCalls).toHaveLength(1);
    expect(collectionCalls[0]).toMatchObject({
      token: "secret",
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      platform: "linux",
      syncedAt: "2026-06-06T12:30:00.000Z",
      syncWindows: {
        serverTime: "2026-06-06T12:00:00.000Z",
        until: "2026-06-06",
        providers: [
          { provider: "claude_code", since: "2026-06-05" },
          { provider: "codex", since: "2026-06-06" },
        ],
      },
    });
  });

  it("records failed lastSync when sync-window lookup fails before provider collection", async () => {
    const writes: CliConfig[] = [];

    await expect(
      syncUsage({
        readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
        writeConfig: async (config) => {
          writes.push(config);
        },
        serverClient: matchingServerClient({
          readSyncWindows: async () => {
            throw new Error("sync windows unavailable");
          },
        }),
        collectAndSubmitUsage: async () => {
          throw new Error("should not collect providers");
        },
        now: () => new Date("2026-06-06T12:30:00.000Z"),
        platform: "linux",
        cliVersion: "0.1.0",
        createDeviceId: () => "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        readDeviceName: () => "nayan-vps",
        log: () => {},
      }),
    ).rejects.toThrow("sync windows unavailable");

    expect(writes).toEqual([
      {
        serverUrl: "https://token-burn.test",
        token: "secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
      },
      {
        serverUrl: "https://token-burn.test",
        token: "secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        lastSync: {
          ok: false,
          message: "Submitted 0 usage rows. Failed before provider collection: sync windows unavailable.",
          at: "2026-06-06T12:30:00.000Z",
        },
      },
    ]);
  });

  it("records failed lastSync when sync-window response parsing fails in the server client", async () => {
    const writes: CliConfig[] = [];

    await expect(
      syncUsage({
        readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
        writeConfig: async (config) => {
          writes.push(config);
        },
        serverClient: matchingServerClient({
          readSyncWindows: async () => {
            throw new Error("Invalid sync windows response");
          },
        }),
        collectAndSubmitUsage: async () => {
          throw new Error("should not collect providers");
        },
        now: () => new Date("2026-06-06T12:30:00.000Z"),
        platform: "linux",
        cliVersion: "0.1.0",
        createDeviceId: () => "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        readDeviceName: () => "nayan-vps",
        log: () => {},
      }),
    ).rejects.toThrow();

    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual({
      serverUrl: "https://token-burn.test",
      token: "secret",
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
    });
    expect(writes[1]).toMatchObject({
      serverUrl: "https://token-burn.test",
      token: "secret",
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      lastSync: {
        ok: false,
        at: "2026-06-06T12:30:00.000Z",
      },
    });
    expect(writes[1]?.lastSync?.message).toContain("Submitted 0 usage rows. Failed before provider collection:");
  });

  it("refuses to sync when the server requires a different CLI version", async () => {
    let collectAndSubmitUsageCalled = false;
    let submitSyncPayloadCalled = false;
    const serverRequiredCliVersion = createDifferentVersion(currentCliVersion);

    await expect(
      syncUsage({
        readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
        serverClient: matchingServerClient({
          readHealth: async () => ({
            requiredCliVersion: serverRequiredCliVersion,
            serverTime: "2026-06-03T00:00:00.000Z",
          }),
          submitSyncPayload: async () => {
            submitSyncPayloadCalled = true;
            return { accepted: true };
          },
        }),
        collectAndSubmitUsage: async () => {
          collectAndSubmitUsageCalled = true;
          return { submitted: 0, failedProviders: [], skippedProviders: [] };
        },
        cliVersion: currentCliVersion,
        log: () => {},
      }),
    ).rejects.toThrow(
      `Token Burn requires token-burn ${serverRequiredCliVersion}. You have ${currentCliVersion}. Run npm install -g @blnayan/token-burn@latest.`,
    );

    expect(collectAndSubmitUsageCalled).toBe(false);
    expect(submitSyncPayloadCalled).toBe(false);
  });

  it("reuses remembered device identity instead of creating a new one", async () => {
    const collectionCalls: SyncCollectionOptions[] = [];

    await syncUsage({
      readConfig: async () => ({
        serverUrl: "https://token-burn.test",
        token: "secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "workstation",
      }),
      writeConfig: async () => {},
      serverClient: matchingServerClient(),
      collectAndSubmitUsage: async (options) => {
        collectionCalls.push(options);
        return { submitted: 2, failedProviders: [], skippedProviders: [] };
      },
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      platform: "linux",
      cliVersion: "0.1.0",
      createDeviceId: () => {
        throw new Error("should not create a new device id");
      },
      readDeviceName: () => "renamed-workstation",
      log: () => {},
    });

    expect(collectionCalls).toHaveLength(1);
    expect(collectionCalls[0]).toMatchObject({
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "renamed-workstation",
    });
  });

  it("records skipped unsupported providers as a successful sync when supported providers submit", async () => {
    const writes: CliConfig[] = [];
    const logs: string[] = [];

    await syncUsage({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
      writeConfig: async (config) => {
        writes.push(config);
      },
      serverClient: matchingServerClient(),
      collectAndSubmitUsage: async () => ({
        submitted: 1,
        failedProviders: [],
        skippedProviders: [
          {
            provider: "codex",
            message: "ccusage does not support Codex usage in the installed version",
          },
        ],
      }),
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      platform: "linux",
      cliVersion: "0.1.0",
      createDeviceId: () => "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      readDeviceName: () => "nayan-vps",
      log: (message) => {
        logs.push(message);
      },
    });

    expect(writes).toEqual([
      {
        serverUrl: "https://token-burn.test",
        token: "secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
      },
      {
        serverUrl: "https://token-burn.test",
        token: "secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        lastSync: {
          ok: true,
          message:
            "Submitted 1 usage row. Skipped providers: codex: ccusage does not support Codex usage in the installed version.",
          at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);
    expect(logs).toEqual([
      "Submitted 1 usage row. Skipped providers: codex: ccusage does not support Codex usage in the installed version.",
    ]);
  });

  it("records providers without local usage data as skipped instead of failed", async () => {
    const writes: CliConfig[] = [];
    const logs: string[] = [];

    await syncUsage({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
      writeConfig: async (config) => {
        writes.push(config);
      },
      serverClient: matchingServerClient(),
      collectAndSubmitUsage: async () => ({
        submitted: 0,
        failedProviders: [],
        skippedProviders: [
          { provider: "claude_code", message: "No valid Claude data directories found" },
          {
            provider: "codex",
            message: "ccusage does not support Codex usage in the installed version",
          },
        ],
      }),
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      platform: "linux",
      cliVersion: "0.1.0",
      createDeviceId: () => "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      readDeviceName: () => "nayan-vps",
      log: (message) => {
        logs.push(message);
      },
    });

    expect(writes).toEqual([
      {
        serverUrl: "https://token-burn.test",
        token: "secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
      },
      {
        serverUrl: "https://token-burn.test",
        token: "secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        lastSync: {
          ok: true,
          message:
            "Submitted 0 usage rows. Skipped providers: claude_code: No valid Claude data directories found; codex: ccusage does not support Codex usage in the installed version.",
          at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);
    expect(logs).toEqual([
      "Submitted 0 usage rows. Skipped providers: claude_code: No valid Claude data directories found; codex: ccusage does not support Codex usage in the installed version.",
    ]);
  });

  it("records actual provider failures as failed even when another provider submits", async () => {
    const writes: CliConfig[] = [];
    const logs: string[] = [];

    await syncUsage({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
      writeConfig: async (config) => {
        writes.push(config);
      },
      serverClient: matchingServerClient(),
      collectAndSubmitUsage: async () => ({
        submitted: 1,
        failedProviders: [{ provider: "claude_code", message: "ccusage daily failed" }],
        skippedProviders: [],
      }),
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      platform: "linux",
      cliVersion: "0.1.0",
      createDeviceId: () => "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      readDeviceName: () => "nayan-vps",
      log: (message) => {
        logs.push(message);
      },
    });

    expect(writes).toEqual([
      {
        serverUrl: "https://token-burn.test",
        token: "secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
      },
      {
        serverUrl: "https://token-burn.test",
        token: "secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        lastSync: {
          ok: false,
          message: "Submitted 1 usage row. Failed providers: claude_code: ccusage daily failed.",
          at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);
    expect(logs).toEqual(["Submitted 1 usage row. Failed providers: claude_code: ccusage daily failed."]);
  });

  it("explains ccusage native binary chmod failures without suggesting sudo sync", async () => {
    const writes: CliConfig[] = [];

    await expect(
      syncUsage({
        readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
        writeConfig: async (config) => {
          writes.push(config);
        },
        serverClient: matchingServerClient(),
        collectAndSubmitUsage: async () => ({
          submitted: 0,
          failedProviders: [
            {
              provider: "claude_code",
              message:
                "ccusage native binary is not executable because the global npm install is not user-writable. Reinstall @blnayan/token-burn in a user-writable Node environment, or fix the binary execute bit once. Do not run token-burn sync with sudo",
            },
          ],
          skippedProviders: [],
        }),
        now: () => new Date("2026-06-01T00:00:00.000Z"),
        platform: "linux",
        cliVersion: "0.1.0",
        createDeviceId: () => "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        readDeviceName: () => "nayan-vps",
        log: () => {},
      }),
    ).rejects.toThrow(
      "ccusage native binary is not executable because the global npm install is not user-writable. Reinstall @blnayan/token-burn in a user-writable Node environment, or fix the binary execute bit once. Do not run token-burn sync with sudo.",
    );

    expect(writes[1]?.lastSync?.message).toContain(
      "ccusage native binary is not executable because the global npm install is not user-writable",
    );
  });

  it("writes failed lastSync before throwing when supported providers fail and unsupported providers are skipped", async () => {
    const writes: CliConfig[] = [];

    await expect(
      syncUsage({
        readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
        writeConfig: async (config) => {
          writes.push(config);
        },
        serverClient: matchingServerClient(),
        collectAndSubmitUsage: async () => ({
          submitted: 0,
          failedProviders: [{ provider: "claude_code", message: "ccusage daily failed" }],
          skippedProviders: [
            {
              provider: "codex",
              message: "ccusage does not support Codex usage in the installed version",
            },
          ],
        }),
        now: () => new Date("2026-06-01T00:00:00.000Z"),
        platform: "linux",
        cliVersion: "0.1.0",
        createDeviceId: () => "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        readDeviceName: () => "nayan-vps",
        log: () => {},
      }),
    ).rejects.toThrow("All supported providers failed: claude_code: ccusage daily failed.");

    expect(writes).toEqual([
      {
        serverUrl: "https://token-burn.test",
        token: "secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
      },
      {
        serverUrl: "https://token-burn.test",
        token: "secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        lastSync: {
          ok: false,
          message:
            "Submitted 0 usage rows. Failed providers: claude_code: ccusage daily failed. Skipped providers: codex: ccusage does not support Codex usage in the installed version.",
          at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);
  });
});

function matchingServerClient(overrides: Partial<SyncServerClient> = {}): SyncServerClient {
  return {
    readHealth: matchingHealth,
    readSyncWindows: fullSyncWindows,
    submitSyncPayload: async () => ({ accepted: true }),
    ...overrides,
  };
}

async function matchingHealth() {
  return {
    requiredCliVersion: "0.1.0",
    serverTime: "2026-06-03T00:00:00.000Z",
  };
}

async function fullSyncWindows(): Promise<SyncWindowsResponse> {
  return {
    serverTime: "2026-06-06T12:00:00.000Z",
    until: "2026-06-06",
    providers: [{ provider: "claude_code" }, { provider: "codex" }],
  };
}

function createDifferentVersion(version: string): string {
  const major = Number(version.split(".")[0] ?? 0);

  return `${major + 1}.0.0`;
}
