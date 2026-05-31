import { describe, expect, it } from "vitest";
import { formatTokens, sumTokenCategories } from "./tokens";

describe("sumTokenCategories", () => {
  it("counts every token category in the score", () => {
    expect(
      sumTokenCategories({
        input: 100,
        output: 50,
        cacheCreate: 25,
        cacheRead: 10,
        other: 5,
      }),
    ).toBe(190);
  });

  it("rejects negative token values", () => {
    expect(() => sumTokenCategories({ input: -1 })).toThrow("Token totals cannot be negative");
  });
});

describe("formatTokens", () => {
  it("formats leaderboard-scale numbers", () => {
    expect(formatTokens(12400)).toBe("12.4K");
    expect(formatTokens(12400000)).toBe("12.4M");
  });
});
