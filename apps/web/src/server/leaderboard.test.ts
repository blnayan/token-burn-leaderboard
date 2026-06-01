import { describe, expect, it } from "vitest";
import { bigIntToSafeNumber, rankRows } from "./leaderboard";

describe("rankRows", () => {
  it("sorts by total tokens descending and assigns ranks", () => {
    expect(
      rankRows([
        { displayName: "Ada", totalTokens: 100n },
        { displayName: "Linus", totalTokens: 300n },
        { displayName: "Grace", totalTokens: 200n },
      ]),
    ).toEqual([
      { rank: 1, displayName: "Linus", totalTokens: 300 },
      { rank: 2, displayName: "Grace", totalTokens: 200 },
      { rank: 3, displayName: "Ada", totalTokens: 100 },
    ]);
  });

  it("sorts tied totals by display name ascending", () => {
    expect(
      rankRows([
        { displayName: "Linus", totalTokens: 200n },
        { displayName: "Ada", totalTokens: 200n },
        { displayName: "Grace", totalTokens: 300n },
      ]),
    ).toEqual([
      { rank: 1, displayName: "Grace", totalTokens: 300 },
      { rank: 2, displayName: "Ada", totalTokens: 200 },
      { rank: 3, displayName: "Linus", totalTokens: 200 },
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
