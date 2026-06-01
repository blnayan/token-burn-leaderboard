import { describe, expect, it } from "vitest";

import { UnsupportedCcusageProviderError } from "./ccusage.js";
import type { CliConfig } from "./config.js";
import { syncUsage } from "./sync.js";

describe("syncUsage", () => {
  it("throws a helpful login message when no token is configured", async () => {
    await expect(
      syncUsage({
        readConfig: async () => ({ serverUrl: "https://token-burn.test" }),
      }),
    ).rejects.toThrow("Run token-burn login --server https://token-burn.test to authenticate.");
  });

  it("posts payloads and writes successful lastSync after a successful sync", async () => {
    const writes: CliConfig[] = [];
    const posts: Array<{ url: string; body: unknown; token?: string }> = [];
    const logs: string[] = [];

    await syncUsage({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
      writeConfig: async (config) => {
        writes.push(config);
      },
      postJson: async (url, body, token) => {
        posts.push({ url, body, token });
        return { ok: true };
      },
      readProviderUsage: async (provider) => [
        {
          provider,
          date: "2026-05-31",
          tokenCategories:
            provider === "codex"
              ? { input: 100, output: 25, cacheCreate: 0, cacheRead: 0 }
              : { input: 50, output: 25 },
          ...(provider === "codex" ? { tokenDetails: { reasoningOutput: 5 } } : {}),
          totalTokens: provider === "codex" ? 125 : 75,
          ...(provider === "codex"
            ? {
                costUsd: 0.123456,
                costSource: "ccusage" as const,
                sourceSnapshot: { costUSD: 0.123456, totalTokens: 125 },
                models: [
                  {
                    modelName: "gpt-5.5",
                    tokenCategories: { input: 100, output: 25, cacheCreate: 0, cacheRead: 0 },
                    tokenDetails: { reasoningOutput: 5 },
                    totalTokens: 125,
                    metadata: { isFallback: false },
                  },
                ],
              }
            : {}),
        },
      ],
      readCcusageVersion: async () => "16.2.5",
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      platform: "linux",
      cliVersion: "0.1.0",
      createDeviceId: () => "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      readDeviceName: () => "nayan-vps",
      log: (message) => {
        logs.push(message);
      },
    });

    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      url: "https://token-burn.test/api/sync",
      token: "secret",
    });
    expect(posts.map((post) => post.body)).toEqual([
      {
        provider: "claude_code",
        date: "2026-05-31",
        tokenCategories: { input: 50, output: 25 },
        totalTokens: 75,
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        cliVersion: "0.1.0",
        ccusageVersion: "16.2.5",
        os: "linux",
        syncedAt: "2026-06-01T00:00:00.000Z",
      },
      {
        provider: "codex",
        date: "2026-05-31",
        tokenCategories: { input: 100, output: 25, cacheCreate: 0, cacheRead: 0 },
        tokenDetails: { reasoningOutput: 5 },
        totalTokens: 125,
        costUsd: 0.123456,
        costSource: "ccusage",
        sourceSnapshot: { costUSD: 0.123456, totalTokens: 125 },
        models: [
          {
            modelName: "gpt-5.5",
            tokenCategories: { input: 100, output: 25, cacheCreate: 0, cacheRead: 0 },
            tokenDetails: { reasoningOutput: 5 },
            totalTokens: 125,
            metadata: { isFallback: false },
          },
        ],
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        cliVersion: "0.1.0",
        ccusageVersion: "16.2.5",
        os: "linux",
        syncedAt: "2026-06-01T00:00:00.000Z",
      },
    ]);
    expect(writes).toEqual([
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

  it("reuses remembered device identity instead of creating a new one", async () => {
    const posts: Array<{ body: unknown }> = [];

    await syncUsage({
      readConfig: async () => ({
        serverUrl: "https://token-burn.test",
        token: "secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "workstation",
      }),
      writeConfig: async () => {},
      postJson: async (_url, body) => {
        posts.push({ body });
        return { ok: true };
      },
      readProviderUsage: async (provider) => [
        {
          provider,
          date: "2026-05-31",
          tokenCategories: { input: 1 },
          totalTokens: 1,
        },
      ],
      readCcusageVersion: async () => "20.0.6",
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      platform: "linux",
      cliVersion: "0.1.0",
      createDeviceId: () => {
        throw new Error("should not create a new device id");
      },
      readDeviceName: () => "renamed-workstation",
      log: () => {},
    });

    expect(posts.map((post) => post.body)).toMatchObject([
      {
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "renamed-workstation",
      },
      {
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "renamed-workstation",
      },
    ]);
  });

  it("records skipped unsupported providers as a successful sync when supported providers submit", async () => {
    const writes: CliConfig[] = [];
    const logs: string[] = [];

    await syncUsage({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
      writeConfig: async (config) => {
        writes.push(config);
      },
      postJson: async () => ({ ok: true }),
      readProviderUsage: async (provider) => {
        if (provider === "codex") {
          throw new UnsupportedCcusageProviderError(provider);
        }

        return [
          {
            provider,
            date: "2026-05-31",
            tokenCategories: { input: 100 },
            totalTokens: 100,
          },
        ];
      },
      readCcusageVersion: async () => "16.2.5",
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
      postJson: async () => ({ ok: true }),
      readProviderUsage: async (provider) => {
        if (provider === "claude_code") {
          throw new Error(`file:///repo/node_modules/ccusage/dist/data-loader.js:2186
Error: No valid Claude data directories found. Please ensure at least one of the following exists:
- /home/me/.config/claude/projects
- /home/me/.claude/projects`);
        }

        throw new UnsupportedCcusageProviderError(provider);
      },
      readCcusageVersion: async () => "16.2.5",
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
      postJson: async () => ({ ok: true }),
      readProviderUsage: async (provider) => {
        if (provider === "claude_code") {
          throw new Error("ccusage daily failed");
        }

        return [
          {
            provider,
            date: "2026-05-31",
            tokenCategories: { input: 100 },
            totalTokens: 100,
          },
        ];
      },
      readCcusageVersion: async () => "16.2.5",
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
        lastSync: {
          ok: false,
          message: "Submitted 1 usage row. Failed providers: claude_code: ccusage daily failed.",
          at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);
    expect(logs).toEqual(["Submitted 1 usage row. Failed providers: claude_code: ccusage daily failed."]);
  });

  it("writes failed lastSync before throwing when supported providers fail and unsupported providers are skipped", async () => {
    const writes: CliConfig[] = [];

    await expect(
      syncUsage({
        readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
        writeConfig: async (config) => {
          writes.push(config);
        },
        postJson: async () => ({ ok: true }),
        readProviderUsage: async (provider) => {
          if (provider === "codex") {
            throw new UnsupportedCcusageProviderError(provider);
          }

          throw new Error("ccusage daily failed");
        },
        readCcusageVersion: async () => "16.2.5",
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
