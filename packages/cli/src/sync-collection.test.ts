import { describe, expect, it } from "vitest";

import { UnsupportedCcusageProviderError } from "./ccusage.js";
import { collectAndSubmitUsage } from "./sync-collection.js";

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
      readCcusageVersion: async () => "20.0.6",
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

        return [
          {
            provider,
            date: "2026-05-31",
            tokenCategories: { input: 100, output: 25, cacheCreate: 0, cacheRead: 0 },
            tokenDetails: { reasoningOutput: 5 },
            totalTokens: 125,
            costUsd: 0.123456,
            costSource: "ccusage",
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
      },
    });

    expect(result).toEqual({ submitted: 2, failedProviders: [], skippedProviders: [] });
    expect(readProviderUsageCalls).toEqual([
      { provider: "claude_code", window: { since: "2026-05-31", until: "2026-06-01" } },
      { provider: "codex", window: undefined },
    ]);
    expect(submissions).toEqual([
      {
        token: "secret",
        payload: {
          provider: "claude_code",
          date: "2026-05-31",
          tokenCategories: { input: 10 },
          totalTokens: 10,
          ccusageVersion: "20.0.6",
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
          costSource: "ccusage",
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
          ccusageVersion: "20.0.6",
          deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
          deviceName: "nayan-vps",
          cliVersion: "0.1.0",
          os: "linux",
          syncedAt: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);
  });

  it("classifies unsupported ccusage providers as skipped", async () => {
    const result = await collectAndSubmitUsage({
      token: "secret",
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      platform: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
      syncWindows: { serverTime: "2026-06-01T00:00:00.000Z", until: "2026-06-01", providers: [] },
      serverClient: { submitSyncPayload: async () => ({ accepted: true }) },
      readCcusageVersion: async () => "20.0.6",
      readProviderUsage: async (provider) => {
        if (provider === "codex") throw new UnsupportedCcusageProviderError("codex");
        return [];
      },
    });

    expect(result).toEqual({
      submitted: 0,
      failedProviders: [],
      skippedProviders: [
        {
          provider: "codex",
          message: "ccusage does not support Codex usage in the installed version",
        },
      ],
    });
  });

  it("normalizes native binary permission failures", async () => {
    const result = await collectAndSubmitUsage({
      token: "secret",
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      platform: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
      syncWindows: { serverTime: "2026-06-01T00:00:00.000Z", until: "2026-06-01", providers: [] },
      serverClient: { submitSyncPayload: async () => ({ accepted: true }) },
      readCcusageVersion: async () => "20.0.6",
      readProviderUsage: async () => {
        throw new Error("ccusage native binary is not executable: EPERM chmod");
      },
    });

    expect(result.failedProviders[0]?.message).toBe(
      "ccusage native binary is not executable because the global npm install is not user-writable. Reinstall @blnayan/token-burn in a user-writable Node environment, or fix the binary execute bit once. Do not run token-burn sync with sudo",
    );
  });
});
