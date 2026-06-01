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
        cliVersion: "0.1.0",
        ccusageVersion: "1.2.3",
        os: "linux",
        syncedAt: "2026-05-31T23:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("leaderboardRowSchema", () => {
  it("accepts valid leaderboard rows", () => {
    expect(
      leaderboardRowSchema.parse({
        rank: 1,
        displayName: "Ada",
        totalTokens: 12345,
      }),
    ).toEqual({
      rank: 1,
      displayName: "Ada",
      totalTokens: 12345,
    });
  });

  it("rejects invalid leaderboard rows", () => {
    expect(() => leaderboardRowSchema.parse({ rank: 0, displayName: "Ada", totalTokens: 1 })).toThrow();
    expect(() => leaderboardRowSchema.parse({ rank: 1, displayName: "", totalTokens: 1 })).toThrow();
    expect(() => leaderboardRowSchema.parse({ rank: 1, displayName: "Ada", totalTokens: -1 })).toThrow();
  });
});
