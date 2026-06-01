import { describe, expect, it } from "vitest";
import { createCliLoginCode, hashSecret, isCliLoginExpired } from "./cli-auth";

describe("cli auth helpers", () => {
  it("creates human-copyable login codes", () => {
    expect(createCliLoginCode()).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("hashes secrets deterministically", () => {
    expect(hashSecret("secret")).toBe(hashSecret("secret"));
    expect(hashSecret("secret")).not.toBe("secret");
  });

  it("expires login sessions at the exact expiration time", () => {
    expect(
      isCliLoginExpired(new Date("2026-05-31T00:10:00.000Z"), new Date("2026-05-31T00:10:00.000Z")),
    ).toBe(true);
  });
});
