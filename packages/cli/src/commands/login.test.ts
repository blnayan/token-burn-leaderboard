import { describe, expect, it, vi } from "vitest";

import { runLogin } from "./login.js";

describe("runLogin", () => {
  it("prints the login URL and stores the approved token", async () => {
    const postJson = vi
      .fn()
      .mockResolvedValueOnce({
        loginUrl: "https://token-burn.test/cli/approve/ABCD-2345",
        pollToken: "poll-token",
        expiresAt: "2026-06-01T00:01:00.000Z",
      })
      .mockResolvedValueOnce({
        status: "approved",
        token: "tb_secret",
        member: { displayName: "Ada" },
      });
    const writeConfig = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();

    await runLogin({
      serverUrl: "https://token-burn.test",
      postJson,
      writeConfig,
      log,
      sleep: async () => undefined,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(log).toHaveBeenCalledWith("https://token-burn.test/cli/approve/ABCD-2345");
    expect(log).toHaveBeenCalledWith("Waiting for approval. Press Ctrl+C to cancel.");
    expect(writeConfig).toHaveBeenCalledWith({ serverUrl: "https://token-burn.test", token: "tb_secret" });
    expect(log).toHaveBeenCalledWith("Authenticated as Ada.");
  });
});
