import { describe, expect, it } from "vitest";
import {
  leaderboardRowSchema,
  periodSchema,
  providerSchema,
  syncPayloadSchema,
  tokenCategoriesSchema,
} from "./schemas";

describe("providerSchema", () => {
  it("accepts MVP providers", () => {
    expect(providerSchema.parse("claude_code")).toBe("claude_code");
    expect(providerSchema.parse("codex")).toBe("codex");
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

describe("leaderboardRowSchema", () => {
  it("accepts valid leaderboard rows", () => {
    expect(
      leaderboardRowSchema.parse({
        rank: 1,
        displayName: "A".repeat(80),
        totalTokens: 12345,
      }),
    ).toEqual({
      rank: 1,
      displayName: "A".repeat(80),
      totalTokens: 12345,
    });
  });

  it("rejects invalid leaderboard rows", () => {
    expect(() => leaderboardRowSchema.parse({ rank: 0, displayName: "Ada", totalTokens: 1 })).toThrow();
    expect(() => leaderboardRowSchema.parse({ rank: 1, displayName: "", totalTokens: 1 })).toThrow();
    expect(() => leaderboardRowSchema.parse({ rank: 1, displayName: "A".repeat(81), totalTokens: 1 })).toThrow();
    expect(() => leaderboardRowSchema.parse({ rank: 1, displayName: "Ada", totalTokens: -1 })).toThrow();
  });
});
