import { describe, expect, it } from "vitest";

import { providers } from "@token-burn/shared";
import { collectAndSubmitUsage } from "./sync-collection.js";
import { UnsupportedTokscaleProviderError } from "./tokscale.js";

describe("collectAndSubmitUsage", () => {
  it("maps provider windows, builds sync payloads, and submits rows", async () => {
    const submissions: unknown[] = [];
    const readProviderUsageCalls: Array<{ provider: string; window: unknown }> = [];

    const result = await collectAndSubmitUsage({
      token: "secret",
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      platform: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
      syncWindows: {
        serverTime: "2026-06-01T00:00:00.000Z",
        until: "2026-06-01",
        providers: [
          { provider: "other_provider", since: "2026-05-30" },
          { provider: "claude_code", since: "2026-05-31" },
          { provider: "codex" },
        ],
      },
      serverClient: {
        submitSyncPayload: async (submission) => {
          submissions.push(submission);
          return { accepted: true };
        },
      },
      readSourceVersion: async () => "4.0.4",
      readProviderUsage: async (provider, options) => {
        readProviderUsageCalls.push({ provider, window: options?.window });

        if (provider === "claude_code") {
          return [
            {
              provider,
              date: "2026-05-31",
              tokenCategories: { input: 10 },
              totalTokens: 10,
            },
          ];
        }

        if (provider === "opencode") {
          return [
            {
              provider,
              date: "2026-05-31",
              tokenCategories: { input: 30, output: 5 },
              totalTokens: 35,
            },
          ];
        }

        if (provider === "codex") {
          return [
            {
              provider,
              date: "2026-05-31",
              tokenCategories: { input: 100, output: 25, cacheCreate: 0, cacheRead: 0 },
              tokenDetails: { reasoningOutput: 5 },
              totalTokens: 125,
              costUsd: 0.123456,
              costSource: "tokscale",
              costMetadata: { currency: "USD" },
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
            },
          ];
        }

        return [];
      },
    });

    expect(result).toEqual({ submitted: 3, failedProviders: [], skippedProviders: [] });
    expect(readProviderUsageCalls).toEqual(
      providers.map((provider) => ({
        provider,
        window:
          provider === "claude_code"
            ? { since: "2026-05-31", until: "2026-06-01" }
            : undefined,
      })),
    );
    expect(submissions).toEqual([
      {
        token: "secret",
        payload: {
          provider: "claude_code",
          date: "2026-05-31",
          tokenCategories: { input: 10 },
          totalTokens: 10,
          ccusageVersion: "4.0.4",
          deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
          deviceName: "nayan-vps",
          cliVersion: "0.1.0",
          os: "linux",
          syncedAt: "2026-06-01T00:00:00.000Z",
        },
      },
      {
        token: "secret",
        payload: {
          provider: "codex",
          date: "2026-05-31",
          tokenCategories: { input: 100, output: 25, cacheCreate: 0, cacheRead: 0 },
          tokenDetails: { reasoningOutput: 5 },
          totalTokens: 125,
          costUsd: 0.123456,
          costSource: "tokscale",
          costMetadata: { currency: "USD" },
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
          ccusageVersion: "4.0.4",
          deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
          deviceName: "nayan-vps",
          cliVersion: "0.1.0",
          os: "linux",
          syncedAt: "2026-06-01T00:00:00.000Z",
        },
      },
      {
        token: "secret",
        payload: {
          provider: "opencode",
          date: "2026-05-31",
          tokenCategories: { input: 30, output: 5 },
          totalTokens: 35,
          ccusageVersion: "4.0.4",
          deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
          deviceName: "nayan-vps",
          cliVersion: "0.1.0",
          os: "linux",
          syncedAt: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);
  });

  it("classifies unsupported tokscale providers as skipped", async () => {
    const result = await collectAndSubmitUsage({
      token: "secret",
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      platform: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
      syncWindows: { serverTime: "2026-06-01T00:00:00.000Z", until: "2026-06-01", providers: [] },
      serverClient: { submitSyncPayload: async () => ({ accepted: true }) },
      readSourceVersion: async () => "4.0.4",
      readProviderUsage: async (provider) => {
        if (provider === "codex") throw new UnsupportedTokscaleProviderError("codex");
        return [];
      },
    });

    expect(result).toEqual({
      submitted: 0,
      failedProviders: [],
      skippedProviders: [
        {
          provider: "codex",
          message: "tokscale does not support Codex usage in the installed version",
        },
      ],
    });
  });

  it("classifies missing Claude data as a skipped provider", async () => {
    const result = await collectAndSubmitUsage({
      token: "secret",
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      platform: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
      syncWindows: { serverTime: "2026-06-01T00:00:00.000Z", until: "2026-06-01", providers: [] },
      serverClient: { submitSyncPayload: async () => ({ accepted: true }) },
      readSourceVersion: async () => "4.0.4",
      readProviderUsage: async (provider) => {
        if (provider === "claude_code") {
          throw new Error(`file:///repo/node_modules/ccusage/dist/data-loader.js:2186
Error: No valid Claude data directories found. Please ensure at least one of the following exists:
- /home/me/.config/claude/projects
- /home/me/.claude/projects`);
        }

        return [];
      },
    });

    expect(result).toEqual({
      submitted: 0,
      failedProviders: [],
      skippedProviders: [{ provider: "claude_code", message: "No valid Claude data directories found" }],
    });
  });

  it("classifies missing data for new providers as skipped", async () => {
    const result = await collectAndSubmitUsage({
      token: "secret",
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      platform: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
      syncWindows: { serverTime: "2026-06-01T00:00:00.000Z", until: "2026-06-01", providers: [] },
      serverClient: { submitSyncPayload: async () => ({ accepted: true }) },
      readSourceVersion: async () => "4.0.4",
      readProviderUsage: async (provider) => {
        if (provider === "opencode") {
          throw new Error("No valid OpenCode data directories found");
        }

        return [];
      },
    });

    expect(result.skippedProviders).toContainEqual({
      provider: "opencode",
      message: "No valid OpenCode data directories found",
    });
    expect(result.failedProviders).toEqual([]);
  });

  it("classifies no provider usage data as skipped", async () => {
    const result = await collectAndSubmitUsage({
      token: "secret",
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      platform: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
      syncWindows: { serverTime: "2026-06-01T00:00:00.000Z", until: "2026-06-01", providers: [] },
      serverClient: { submitSyncPayload: async () => ({ accepted: true }) },
      readSourceVersion: async () => "4.0.4",
      readProviderUsage: async (provider) => {
        if (provider === "opencode") {
          throw new Error("No OpenCode usage data found");
        }

        return [];
      },
    });

    expect(result.skippedProviders).toContainEqual({
      provider: "opencode",
      message: "No OpenCode usage data found",
    });
    expect(result.failedProviders).toEqual([]);
  });
});
