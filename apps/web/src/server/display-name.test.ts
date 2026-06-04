import { describe, expect, it } from "vitest";
import { createDefaultDisplayName, normalizeDisplayName } from "./display-name";

describe("createDefaultDisplayName", () => {
  it("prefers the GitHub display name over the GitHub username", () => {
    expect(createDefaultDisplayName({ githubName: "  Nayan   Bhut  ", githubLogin: "blnayan" })).toBe("Nayan Bhut");
  });

  it("falls back to the GitHub username when there is no GitHub display name", () => {
    expect(createDefaultDisplayName({ githubName: null, githubLogin: "blnayan" })).toBe("blnayan");
    expect(createDefaultDisplayName({ githubName: "   ", githubLogin: "blnayan" })).toBe("blnayan");
  });

  it("supports GitHub usernames longer than the previous 32 character display-name limit", () => {
    const githubLogin = "a".repeat(39);

    expect(createDefaultDisplayName({ githubName: null, githubLogin })).toBe(githubLogin);
  });
});

describe("normalizeDisplayName", () => {
  it("trims names and limits public names to 32 characters", () => {
    expect(normalizeDisplayName("  Token Wizard  ")).toBe("Token Wizard");
    expect(normalizeDisplayName("Token    Wizard")).toBe("Token Wizard");
    expect(normalizeDisplayName("x".repeat(80))).toBe("x".repeat(80));
    expect(() => normalizeDisplayName("x".repeat(81))).toThrow("Display name must be 80 characters or fewer");
  });

  it("rejects empty names", () => {
    expect(() => normalizeDisplayName("   ")).toThrow("Display name is required");
  });
});
