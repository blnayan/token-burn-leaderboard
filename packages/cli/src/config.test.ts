import { describe, expect, it } from "vitest";
import { getConfigPath } from "./config.js";

describe("getConfigPath", () => {
  it("uses TOKEN_BURN_CONFIG_DIR when provided", () => {
    expect(getConfigPath({ TOKEN_BURN_CONFIG_DIR: "/tmp/token-burn" })).toBe("/tmp/token-burn/config.json");
  });
});
