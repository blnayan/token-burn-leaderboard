import { describe, expect, it } from "vitest";
import { createDefaultDisplayName, normalizeDisplayName } from "./display-name";

describe("createDefaultDisplayName", () => {
  it("uses the full cuid when it fits within the display-name limit", () => {
    expect(createDefaultDisplayName("cmbyzv7g90000qj11d2qtkv9r")).toBe("member-cmbyzv7g90000qj11d2qtkv9r");
  });

  it("uses a deterministic bounded suffix for longer ids", () => {
    const displayName = createDefaultDisplayName("x".repeat(100));

    expect(displayName).toBe(createDefaultDisplayName("x".repeat(100)));
    expect(displayName).toMatch(/^member-[a-f0-9]+$/);
    expect(displayName.length).toBeLessThanOrEqual(32);
  });
});

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
