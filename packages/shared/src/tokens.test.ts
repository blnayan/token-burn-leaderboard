import { describe, expect, it } from "vitest";
import { formatTokens, formatUsd, sumTokenCategories } from "./tokens";

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

  it("truncates compact decimal values", () => {
    expect(formatTokens(12499)).toBe("12.4K");
  });

  it("rejects invalid token totals", () => {
    expect(() => formatTokens(-1)).toThrow("Token totals cannot be negative");
    expect(() => formatTokens(Number.POSITIVE_INFINITY)).toThrow("Token totals must be finite numbers");
  });
});

describe("formatUsd", () => {
  it("formats USD values with a dollar sign, commas, and cents", () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(0.123456)).toBe("$0.12");
  });

  it("rejects invalid cost totals", () => {
    expect(() => formatUsd(-1)).toThrow("Cost totals cannot be negative");
    expect(() => formatUsd(Number.POSITIVE_INFINITY)).toThrow("Cost totals must be finite numbers");
  });
});
