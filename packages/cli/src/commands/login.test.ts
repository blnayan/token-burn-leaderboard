import { describe, expect, it, vi } from "vitest";

import { createLoginCommand, runLogin } from "./login.js";

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
        member: { displayName: "Ada", username: "blnayan" },
      });
    const writeConfig = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    await runLogin({
      serverUrl: "https://token-burn.test",
      postJson,
      readConfig: async () => null,
      writeConfig,
      log,
      openBrowser,
      sleep: async () => undefined,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(openBrowser).toHaveBeenCalledWith("https://token-burn.test/cli/approve/ABCD-2345");
    expect(log).toHaveBeenCalledWith("Opening approval link in your browser...");
    expect(log).toHaveBeenCalledWith("Waiting for approval. Press Ctrl+C to cancel.");
    expect(writeConfig).toHaveBeenCalledWith({ serverUrl: "https://token-burn.test", token: "tb_secret" });
    expect(log).toHaveBeenCalledWith("Authenticated as blnayan.");
  });

  it("prints the login URL when the default browser cannot be opened", async () => {
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
        member: { displayName: "Ada", username: "blnayan" },
      });
    const writeConfig = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();

    await runLogin({
      serverUrl: "https://token-burn.test",
      postJson,
      readConfig: async () => null,
      writeConfig,
      log,
      openBrowser: vi.fn().mockRejectedValue(new Error("no default browser")),
      sleep: async () => undefined,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(log).toHaveBeenCalledWith(
      "Could not open your browser automatically. Open this link in your browser: https://token-burn.test/cli/approve/ABCD-2345",
    );
    expect(log).not.toHaveBeenCalledWith("Waiting for approval. Press Ctrl+C to cancel.");
    expect(writeConfig).toHaveBeenCalledWith({ serverUrl: "https://token-burn.test", token: "tb_secret" });
  });

  it("preserves the existing device identity when re-authenticating", async () => {
    const postJson = vi
      .fn()
      .mockResolvedValueOnce({
        loginUrl: "https://token-burn.test/cli/approve/ABCD-2345",
        pollToken: "poll-token",
        expiresAt: "2026-06-01T00:01:00.000Z",
      })
      .mockResolvedValueOnce({
        status: "approved",
        token: "tb_new_secret",
        member: { displayName: "Ada", username: "blnayan" },
      });
    const readConfig = vi.fn().mockResolvedValue({
      serverUrl: "https://old-token-burn.test",
      token: "tb_old_secret",
      deviceId: "d5365b9a-0000-4000-8000-000000000000",
      deviceName: "Nayans-MacBook-Air.local",
    });
    const writeConfig = vi.fn().mockResolvedValue(undefined);

    await runLogin({
      serverUrl: "https://token-burn.test",
      postJson,
      readConfig,
      writeConfig,
      log: vi.fn(),
      sleep: async () => undefined,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(writeConfig).toHaveBeenCalledWith({
      serverUrl: "https://token-burn.test",
      token: "tb_new_secret",
      deviceId: "d5365b9a-0000-4000-8000-000000000000",
      deviceName: "Nayans-MacBook-Air.local",
    });
  });
});

describe("createLoginCommand", () => {
  it("exposes --server-url as the server URL option", () => {
    const help = createLoginCommand().helpInformation();

    expect(help).toContain("--server-url <url>");
  });

  it("keeps --server as a server URL alias", () => {
    const help = createLoginCommand().helpInformation();

    expect(help).toContain("--server <url>");
  });
});
