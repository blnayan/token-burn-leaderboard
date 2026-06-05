import { describe, expect, it, vi } from "vitest";

import { resolveOutputMode } from "../ui/mode.js";
import { createRenderer } from "../ui/renderer.js";
import type { UiRenderer } from "../ui/types.js";
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

    const calls: string[] = [];

    const result = await runLogin({
      serverUrl: "https://token-burn.test",
      postJson,
      readConfig: async () => null,
      writeConfig,
      ui: createRecordingUi(calls),
      openBrowser,
      sleep: async () => undefined,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(result).toEqual({ authenticatedAs: "blnayan", serverUrl: "https://token-burn.test" });
    expect(openBrowser).toHaveBeenCalledWith("https://token-burn.test/cli/approve/ABCD-2345");
    expect(calls).toContain("step:login:Opening approval link in your browser");
    expect(calls).toContain("info:Waiting for approval. Press Ctrl+C to cancel.");
    expect(writeConfig).toHaveBeenCalledWith({ serverUrl: "https://token-burn.test", token: "tb_secret" });
    expect(calls).toContain("success:login:Authenticated as blnayan");
    expect(readResultCall(calls)).toEqual({ ok: true, authenticatedAs: "blnayan", serverUrl: "https://token-burn.test" });
    expect(log).not.toHaveBeenCalled();
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

    const result = await runLogin({
      serverUrl: "https://token-burn.test",
      postJson,
      readConfig: async () => null,
      writeConfig,
      log,
      openBrowser: vi.fn().mockRejectedValue(new Error("no default browser")),
      sleep: async () => undefined,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(result).toEqual({ authenticatedAs: "blnayan", serverUrl: "https://token-burn.test" });
    expect(log).toHaveBeenCalledWith(
      "Warning: Could not open your browser automatically",
    );
    expect(log).toHaveBeenCalledWith(
      "Next: Open this link in your browser: https://token-burn.test/cli/approve/ABCD-2345",
    );
    expect(log).not.toHaveBeenCalledWith("Waiting for approval. Press Ctrl+C to cancel.");
    expect(writeConfig).toHaveBeenCalledWith({ serverUrl: "https://token-burn.test", token: "tb_secret" });
  });

  it("emits pending approval JSON before polling when requested", async () => {
    const lines: string[] = [];
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

    await runLogin({
      serverUrl: "https://token-burn.test",
      postJson,
      readConfig: async () => null,
      writeConfig: vi.fn(),
      ui: createRenderer(resolveOutputMode({ flags: { json: true } }), { write: (line) => lines.push(line) }),
      emitPendingApprovalResult: true,
      openBrowser: vi.fn().mockRejectedValue(new Error("no default browser")),
      sleep: async () => undefined,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(lines).toEqual([
      JSON.stringify({
        ok: true,
        status: "pending_approval",
        loginUrl: "https://token-burn.test/cli/approve/ABCD-2345",
        serverUrl: "https://token-burn.test",
        expiresAt: "2026-06-01T00:01:00.000Z",
      }),
      JSON.stringify({ ok: true, authenticatedAs: "blnayan", serverUrl: "https://token-burn.test" }),
    ]);
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

function readResultCall(calls: string[]): Record<string, unknown> {
  const result = calls.find((call) => call.startsWith("result:"));

  if (!result) throw new Error("Missing result call");

  return JSON.parse(result.slice("result:".length)) as Record<string, unknown>;
}

function createRecordingUi(calls: string[]): UiRenderer {
  return {
    intro: (title, details = []) => calls.push(`intro:${title}:${details.length}`),
    step: (id, message) => calls.push(`step:${id}:${message}`),
    success: (id, message) => calls.push(`success:${id}:${message}`),
    warning: (id, message) => calls.push(`warning:${id}:${message}`),
    info: (message) => calls.push(`info:${message}`),
    table: (title) => calls.push(`table:${title}`),
    summary: (title, details = []) => calls.push(`summary:${title}:${details.length}`),
    nextAction: (message) => calls.push(`next:${message}`),
    error: (error) => calls.push(`error:${error.code}:${error.message}`),
    result: (result) => calls.push(`result:${JSON.stringify(result)}`),
  };
}

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
