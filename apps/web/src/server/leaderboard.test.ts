import { describe, expect, it } from "vitest";
import { bigIntToSafeNumber, rankRows } from "./leaderboard";

describe("rankRows", () => {
  it("sorts by total tokens descending and assigns ranks", () => {
    expect(
      rankRows([
        { username: "ada", displayName: "Ada", totalTokens: 100n, totalCostUsd: 1.25 },
        { username: "linus", displayName: "Linus", totalTokens: 300n, totalCostUsd: 12.5 },
        { username: "grace", displayName: "Grace", totalTokens: 200n, totalCostUsd: 3 },
      ]),
    ).toEqual([
      { rank: 1, username: "linus", displayName: "Linus", totalTokens: 300, totalCostUsd: 12.5 },
      { rank: 2, username: "grace", displayName: "Grace", totalTokens: 200, totalCostUsd: 3 },
      { rank: 3, username: "ada", displayName: "Ada", totalTokens: 100, totalCostUsd: 1.25 },
    ]);
  });

  it("sorts tied totals by display name ascending", () => {
    expect(
      rankRows([
        { username: "linus", displayName: "Linus", totalTokens: 200n, totalCostUsd: 2 },
        { username: "ada", displayName: "Ada", totalTokens: 200n, totalCostUsd: 1 },
        { username: "grace", displayName: "Grace", totalTokens: 300n, totalCostUsd: 3 },
      ]),
    ).toEqual([
      { rank: 1, username: "grace", displayName: "Grace", totalTokens: 300, totalCostUsd: 3 },
      { rank: 2, username: "ada", displayName: "Ada", totalTokens: 200, totalCostUsd: 1 },
      { rank: 3, username: "linus", displayName: "Linus", totalTokens: 200, totalCostUsd: 2 },
    ]);
  });
});

describe("bigIntToSafeNumber", () => {
  it("converts safe bigint totals to numbers", () => {
    expect(bigIntToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("throws when totals exceed JavaScript safe integer precision", () => {
    expect(() => bigIntToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(
      "Token total exceeds JavaScript safe integer precision",
    );
  });
});
