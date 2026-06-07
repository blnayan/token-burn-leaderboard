import { describe, expect, it } from "vitest";
import { getPeriodRange, getRecentUtcDateWindow } from "./time";

describe("getPeriodRange", () => {
  it("uses UTC day boundaries", () => {
    const range = getPeriodRange("daily", new Date("2026-05-31T23:30:00.000Z"));
    expect(range).toEqual({
      start: new Date("2026-05-31T00:00:00.000Z"),
      end: new Date("2026-06-01T00:00:00.000Z"),
    });
  });

  it("uses ISO week boundaries", () => {
    const range = getPeriodRange("weekly", new Date("2026-05-31T12:00:00.000Z"));
    expect(range.start.toISOString()).toBe("2026-05-25T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("uses UTC month boundaries", () => {
    const range = getPeriodRange("monthly", new Date("2026-05-31T12:00:00.000Z"));
    expect(range.start.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("returns an open range for all-time", () => {
    expect(getPeriodRange("all-time", new Date("2026-05-31T12:00:00.000Z"))).toEqual({
      start: null,
      end: null,
    });
  });
});

describe("getRecentUtcDateWindow", () => {
  it("returns inclusive UTC dates ending on the current UTC date", () => {
    expect(getRecentUtcDateWindow(3, new Date("2026-06-07T15:30:00.000Z"))).toEqual([
      "2026-06-05",
      "2026-06-06",
      "2026-06-07",
    ]);
  });

  it("rejects non-positive window sizes", () => {
    expect(() => getRecentUtcDateWindow(0, new Date("2026-06-07T00:00:00.000Z"))).toThrow(
      "UTC date window must include at least one day",
    );
  });
});
