import { describe, expect, it } from "vitest";
import { configSchema, getConfigPath } from "./config.js";

describe("getConfigPath", () => {
  it("uses TOKEN_BURN_CONFIG_DIR when provided", () => {
    expect(getConfigPath({ TOKEN_BURN_CONFIG_DIR: "/tmp/token-burn" })).toBe("/tmp/token-burn/config.json");
  });
});

describe("configSchema", () => {
  it("supports a logged-out config with last sync metadata", () => {
    expect(
      configSchema.parse({
        serverUrl: "https://token-burn.test",
        lastSync: {
          ok: false,
          message: "Token expired",
          at: "2026-06-01T00:00:00.000Z",
        },
      }),
    ).toEqual({
      serverUrl: "https://token-burn.test",
      lastSync: {
        ok: false,
        message: "Token expired",
        at: "2026-06-01T00:00:00.000Z",
      },
    });
  });
});
