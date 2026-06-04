import { describe, expect, it } from "vitest";
import { normalizeDisplayName } from "./display-name";

describe("normalizeDisplayName", () => {
  it("trims names and limits public names to 32 characters", () => {
    expect(normalizeDisplayName("  Token Wizard  ")).toBe("Token Wizard");
    expect(normalizeDisplayName("Token    Wizard")).toBe("Token Wizard");
    expect(() => normalizeDisplayName("x".repeat(33))).toThrow("Display name must be 32 characters or fewer");
  });

  it("rejects empty names", () => {
    expect(() => normalizeDisplayName("   ")).toThrow("Display name is required");
  });
});
