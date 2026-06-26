import { describe, expect, it } from "vitest";
import {
  formatProvider,
  leaderboardRowSchema,
  memberUsageDetailSchema,
  memberUsageRangeSchema,
  periodSchema,
  providerMetadata,
  providerSchema,
  providers,
  syncPayloadSchema,
  syncWindowsResponseSchema,
  tokenCategoriesSchema,
} from "./schemas";

describe("providerSchema", () => {
  it("accepts every supported ccusage provider in stable order", () => {
    expect(providers).toEqual([
      "claude_code",
      "codex",
      "opencode",
      "amp",
      "droid",
      "codebuff",
      "hermes",
      "pi",
      "goose",
      "kilo",
      "copilot",
      "gemini",
      "kimi",
      "qwen",
      "openclaw",
    ]);

    for (const provider of providers) {
      expect(providerSchema.parse(provider)).toBe(provider);
    }
  });

  it("exports readable labels and ccusage command names", () => {
    expect(providerMetadata.claude_code).toEqual({
      id: "claude_code",
      label: "Claude Code",
      ccusageCommand: "claude",
    });
    expect(providerMetadata.copilot).toEqual({
      id: "copilot",
      label: "GitHub Copilot CLI",
      ccusageCommand: "copilot",
    });
    expect(formatProvider("opencode")).toBe("OpenCode");
    expect(formatProvider("gemini")).toBe("Gemini CLI");
  });

  it("rejects unknown providers", () => {
    expect(() => providerSchema.parse("future_provider")).toThrow();
  });
});

describe("periodSchema", () => {
  it("accepts leaderboard periods", () => {
    expect(periodSchema.parse("daily")).toBe("daily");
    expect(periodSchema.parse("weekly")).toBe("weekly");
    expect(periodSchema.parse("monthly")).toBe("monthly");
    expect(periodSchema.parse("all-time")).toBe("all-time");
  });
});

describe("memberUsageRangeSchema", () => {
  it("accepts dialog usage ranges", () => {
    expect(memberUsageRangeSchema.parse("7d")).toBe("7d");
    expect(memberUsageRangeSchema.parse("30d")).toBe("30d");
  });

  it("rejects unsupported dialog usage ranges", () => {
    expect(() => memberUsageRangeSchema.parse("daily")).toThrow();
    expect(() => memberUsageRangeSchema.parse("all-time")).toThrow();
  });
});

describe("tokenCategoriesSchema", () => {
  it("accepts nonnegative integer token categories", () => {
    expect(tokenCategoriesSchema.parse({ input: 100, output: 0 })).toEqual({ input: 100, output: 0 });
  });

  it("rejects negative or fractional token categories", () => {
    expect(() => tokenCategoriesSchema.parse({ input: -1 })).toThrow();
    expect(() => tokenCategoriesSchema.parse({ input: 1.5 })).toThrow();
  });

  it("rejects unsafe token category integers", () => {
    expect(() => tokenCategoriesSchema.parse({ input: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
  });
});

describe("syncPayloadSchema", () => {
  it("accepts aggregate daily provider snapshots", () => {
    const payload = syncPayloadSchema.parse({
      provider: "codex",
      date: "2026-05-31",
      tokenCategories: {
        input: 100,
        output: 200,
        cacheCreate: 50,
        cacheRead: 25,
      },
      totalTokens: 375,
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      ccusageVersion: "1.2.3",
      os: "linux",
      syncedAt: "2026-05-31T23:00:00.000Z",
    });

    expect(payload.totalTokens).toBe(375);
  });

  it("accepts expanded ccusage providers in sync payloads", () => {
    const payload = syncPayloadSchema.parse({
      provider: "opencode",
      date: "2026-06-01",
      tokenCategories: {
        input: 50,
        output: 25,
        cacheCreate: 0,
        cacheRead: 5,
      },
      totalTokens: 80,
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      ccusageVersion: "20.0.6",
      os: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
    });

    expect(payload.provider).toBe("opencode");
  });

  it("rejects totals that do not match token categories", () => {
    expect(() =>
      syncPayloadSchema.parse({
        provider: "codex",
        date: "2026-05-31",
        tokenCategories: {
          input: 100,
          output: 200,
        },
        totalTokens: 301,
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        cliVersion: "0.1.0",
        ccusageVersion: "1.2.3",
        os: "linux",
        syncedAt: "2026-05-31T23:00:00.000Z",
      }),
    ).toThrow("totalTokens must equal the sum of tokenCategories");
  });

  it("rejects unsafe total token integers", () => {
    expect(() =>
      syncPayloadSchema.parse({
        provider: "codex",
        date: "2026-05-31",
        tokenCategories: {
          input: Number.MAX_SAFE_INTEGER,
        },
        totalTokens: Number.MAX_SAFE_INTEGER + 1,
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        cliVersion: "0.1.0",
        ccusageVersion: "1.2.3",
        os: "linux",
        syncedAt: "2026-05-31T23:00:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects unknown providers and negative totals", () => {
    expect(() =>
      syncPayloadSchema.parse({
        provider: "other",
        date: "2026-05-31",
        tokenCategories: { input: -1 },
        totalTokens: -1,
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        cliVersion: "0.1.0",
        ccusageVersion: "1.2.3",
        os: "linux",
        syncedAt: "2026-05-31T23:00:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects missing or invalid device identity", () => {
    expect(() =>
      syncPayloadSchema.parse({
        provider: "codex",
        date: "2026-05-31",
        tokenCategories: { input: 100 },
        totalTokens: 100,
        deviceName: "nayan-vps",
        cliVersion: "0.1.0",
        ccusageVersion: "1.2.3",
        os: "linux",
        syncedAt: "2026-05-31T23:00:00.000Z",
      }),
    ).toThrow();

    expect(() =>
      syncPayloadSchema.parse({
        provider: "codex",
        date: "2026-05-31",
        tokenCategories: { input: 100 },
        totalTokens: 100,
        deviceId: "not-a-uuid",
        deviceName: "",
        cliVersion: "0.1.0",
        ccusageVersion: "1.2.3",
        os: "linux",
        syncedAt: "2026-05-31T23:00:00.000Z",
      }),
    ).toThrow();
  });

  it("accepts cost, token details, and model usage rows", () => {
    const payload = syncPayloadSchema.parse({
      provider: "codex",
      date: "2026-06-01",
      tokenCategories: {
        input: 100,
        output: 50,
        cacheCreate: 0,
        cacheRead: 850,
      },
      tokenDetails: {
        reasoningOutput: 20,
      },
      totalTokens: 1000,
      costUsd: 1.234567,
      costSource: "ccusage",
      costMetadata: {
        speed: "fast",
      },
      sourceSnapshot: {
        costUSD: 1.234567,
        totalTokens: 1000,
      },
      models: [
        {
          modelName: "gpt-5.5",
          tokenCategories: {
            input: 100,
            output: 50,
            cacheCreate: 0,
            cacheRead: 850,
          },
          tokenDetails: {
            reasoningOutput: 20,
          },
          totalTokens: 1000,
          costUsd: 1.234567,
          metadata: {
            isFallback: false,
          },
        },
      ],
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      ccusageVersion: "20.0.6",
      os: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
    });

    expect(payload.costUsd).toBe(1.234567);
    expect(payload.tokenDetails?.reasoningOutput).toBe(20);
    expect(payload.models?.[0]?.modelName).toBe("gpt-5.5");
  });

  it("rejects negative cost and model totals that do not match scoring categories", () => {
    expect(() =>
      syncPayloadSchema.parse({
        provider: "codex",
        date: "2026-06-01",
        tokenCategories: { input: 100 },
        totalTokens: 100,
        costUsd: -1,
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        cliVersion: "0.1.0",
        ccusageVersion: "20.0.6",
        os: "linux",
        syncedAt: "2026-06-01T00:00:00.000Z",
      }),
    ).toThrow();

    expect(() =>
      syncPayloadSchema.parse({
        provider: "codex",
        date: "2026-06-01",
        tokenCategories: { input: 100 },
        totalTokens: 100,
        models: [
          {
            modelName: "gpt-5.5",
            tokenCategories: { input: 100 },
            totalTokens: 101,
          },
        ],
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        cliVersion: "0.1.0",
        ccusageVersion: "20.0.6",
        os: "linux",
        syncedAt: "2026-06-01T00:00:00.000Z",
      }),
    ).toThrow("model totalTokens must equal the sum of tokenCategories");
  });

  it("keeps reasoning output out of scoring token totals", () => {
    const payload = syncPayloadSchema.parse({
      provider: "codex",
      date: "2026-06-01",
      tokenCategories: {
        input: 10,
        output: 20,
      },
      tokenDetails: {
        reasoningOutput: 7,
      },
      totalTokens: 30,
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      ccusageVersion: "20.0.6",
      os: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
    });

    expect(payload.totalTokens).toBe(30);
    expect(payload.tokenDetails).toEqual({ reasoningOutput: 7 });
  });
});

describe("syncWindowsResponseSchema", () => {
  it("accepts provider-specific UTC sync windows", () => {
    const payload = syncWindowsResponseSchema.parse({
      serverTime: "2026-06-06T12:00:00.000Z",
      until: "2026-06-06",
      providers: [
        { provider: "claude_code", since: "2026-06-05" },
        { provider: "codex" },
      ],
    });

    expect(payload.until).toBe("2026-06-06");
    expect(payload.providers[0]?.since).toBe("2026-06-05");
    expect(payload.providers[1]?.since).toBeUndefined();
  });

  it("allows future provider names so older CLIs can ignore them", () => {
    const payload = syncWindowsResponseSchema.parse({
      serverTime: "2026-06-06T12:00:00.000Z",
      until: "2026-06-06",
      providers: [{ provider: "future_provider", since: "2026-06-05" }],
    });

    expect(payload.providers[0]?.provider).toBe("future_provider");
  });

  it("rejects malformed dates", () => {
    expect(() =>
      syncWindowsResponseSchema.parse({
        serverTime: "2026-06-06T12:00:00.000Z",
        until: "20260606",
        providers: [{ provider: "codex", since: "2026-06-05" }],
      }),
    ).toThrow();
  });
});

describe("leaderboardRowSchema", () => {
  it("accepts valid leaderboard rows", () => {
    expect(
      leaderboardRowSchema.parse({
        rank: 1,
        username: "ada",
        displayName: "A".repeat(80),
        totalTokens: 12345,
        totalCostUsd: 1234.5,
      }),
    ).toEqual({
      rank: 1,
      username: "ada",
      displayName: "A".repeat(80),
      totalTokens: 12345,
      totalCostUsd: 1234.5,
    });
  });

  it("rejects invalid leaderboard rows", () => {
    expect(() =>
      leaderboardRowSchema.parse({ rank: 0, username: "ada", displayName: "Ada", totalTokens: 1, totalCostUsd: 0 }),
    ).toThrow();
    expect(() =>
      leaderboardRowSchema.parse({ rank: 1, username: "ada", displayName: "", totalTokens: 1, totalCostUsd: 0 }),
    ).toThrow();
    expect(() =>
      leaderboardRowSchema.parse({
        rank: 1,
        username: "ada",
        displayName: "A".repeat(81),
        totalTokens: 1,
        totalCostUsd: 0,
      }),
    ).toThrow();
    expect(() =>
      leaderboardRowSchema.parse({ rank: 1, username: "ada", displayName: "Ada", totalTokens: -1, totalCostUsd: 0 }),
    ).toThrow();
    expect(() =>
      leaderboardRowSchema.parse({ rank: 1, username: "ada", displayName: "Ada", totalTokens: 1, totalCostUsd: -1 }),
    ).toThrow();
  });

  it("requires a public member username", () => {
    expect(
      leaderboardRowSchema.parse({
        rank: 1,
        username: "ada",
        displayName: "Ada",
        totalTokens: 100,
        totalCostUsd: 1.25,
      }),
    ).toEqual({
      rank: 1,
      username: "ada",
      displayName: "Ada",
      totalTokens: 100,
      totalCostUsd: 1.25,
    });
  });
});

describe("memberUsageDetailSchema", () => {
  it("accepts public aggregate member usage detail", () => {
    const parsed = memberUsageDetailSchema.parse({
        member: {
          username: "ada",
          displayName: "Ada",
        },
        period: "7d",
        summary: {
          rank: 1,
          totalTokens: 300,
          totalCostUsd: 3.5,
        },
        trend: [
          {
            date: "2026-06-01",
            totalTokens: 100,
            totalCostUsd: 1.25,
          },
        ],
        providers: [
          {
            provider: "gemini",
            totalTokens: 100,
            totalCostUsd: 1.25,
          },
        ],
        models: [
          {
            modelName: "gemini-2.5-pro",
            provider: "gemini",
            totalTokens: 80,
            totalCostUsd: 1,
          },
        ],
        devices: [
          {
            deviceId: "device-1",
            deviceName: "Ada MacBook",
            os: "darwin",
            totalTokens: 100,
            totalCostUsd: 1.25,
          },
        ],
    });

    expect(parsed).toMatchObject({
      member: { username: "ada" },
      period: "7d",
      summary: { rank: 1 },
    });
    expect(parsed.devices[0]?.deviceId).toBe("device-1");
  });

  it("rejects public device breakdown rows missing a device id", () => {
    expect(() =>
      memberUsageDetailSchema.parse({
        member: {
          username: "ada",
          displayName: "Ada",
        },
        period: "7d",
        summary: {
          rank: null,
          totalTokens: 0,
          totalCostUsd: 0,
        },
        trend: [],
        providers: [],
        models: [],
        devices: [
          {
            deviceName: "Ada MacBook",
            os: "darwin",
            totalTokens: 100,
            totalCostUsd: 1.25,
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects unknown public providers and operating systems", () => {
    expect(() =>
      memberUsageDetailSchema.parse({
        member: {
          username: "ada",
          displayName: "Ada",
        },
        period: "weekly",
        summary: {
          rank: 1,
          totalTokens: 300,
          totalCostUsd: 3.5,
        },
        trend: [],
        providers: [
          {
            provider: "future_provider",
            totalTokens: 100,
            totalCostUsd: 1.25,
          },
        ],
        models: [],
        devices: [],
      }),
    ).toThrow();

    expect(() =>
      memberUsageDetailSchema.parse({
        member: {
          username: "ada",
          displayName: "Ada",
        },
        period: "weekly",
        summary: {
          rank: 1,
          totalTokens: 300,
          totalCostUsd: 3.5,
        },
        trend: [],
        providers: [],
        models: [],
        devices: [
          {
            deviceId: "device-1",
            deviceName: "Ada Laptop",
            os: "freebsd",
            totalTokens: 100,
            totalCostUsd: 1.25,
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects unsafe aggregate totals", () => {
    expect(() =>
      memberUsageDetailSchema.parse({
        member: {
          username: "ada",
          displayName: "Ada",
        },
        period: "daily",
        summary: {
          rank: null,
          totalTokens: Number.MAX_SAFE_INTEGER + 1,
          totalCostUsd: 0,
        },
        trend: [],
        providers: [],
        models: [],
        devices: [],
      }),
    ).toThrow();
  });
});
