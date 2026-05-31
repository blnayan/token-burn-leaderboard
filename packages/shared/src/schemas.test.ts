import { describe, expect, it } from "vitest";
import { providerSchema, syncPayloadSchema } from "./schemas";

describe("providerSchema", () => {
  it("accepts MVP providers", () => {
    expect(providerSchema.parse("claude_code")).toBe("claude_code");
    expect(providerSchema.parse("codex")).toBe("codex");
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
