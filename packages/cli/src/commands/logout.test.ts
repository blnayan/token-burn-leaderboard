import { describe, expect, it, vi } from "vitest";

import { resolveOutputMode } from "../ui/mode.js";
import { createRenderer } from "../ui/renderer.js";
import type { UiRenderer } from "../ui/types.js";
import { runLogout } from "./logout.js";

describe("runLogout", () => {
  it("removes the token while preserving server URL and last sync", async () => {
    const writeConfig = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();

    const calls: string[] = [];

    const result = await runLogout({
      readConfig: async () => ({
        serverUrl: "https://token-burn.test",
        token: "tb_secret",
        lastSync: {
          ok: true,
          message: "Synced 42 tokens",
          at: "2026-06-01T00:00:00.000Z",
        },
      }),
      writeConfig,
      ui: createRecordingUi(calls),
    });

    expect(result).toEqual({ serverUrl: "https://token-burn.test", wasAuthenticated: true });
    expect(writeConfig).toHaveBeenCalledWith({
      serverUrl: "https://token-burn.test",
      lastSync: {
        ok: true,
        message: "Synced 42 tokens",
        at: "2026-06-01T00:00:00.000Z",
      },
    });
    expect(calls).toContain("success:auth:Logged out");
    expect(readResultCall(calls)).toEqual({
      ok: true,
      serverUrl: "https://token-burn.test",
      wasAuthenticated: true,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("reports not authenticated when no config exists", async () => {
    const writeConfig = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();

    const result = await runLogout({
      readConfig: async () => null,
      writeConfig,
      log,
    });

    expect(result).toEqual({ wasAuthenticated: false });
    expect(writeConfig).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Warning: Not authenticated");
  });

  it("renders JSON output when a JSON renderer is injected", async () => {
    const lines: string[] = [];

    await runLogout({
      readConfig: async () => null,
      writeConfig: vi.fn(),
      ui: createRenderer(resolveOutputMode({ flags: { json: true } }), { write: (line) => lines.push(line) }),
    });

    expect(lines).toEqual([JSON.stringify({ ok: true, wasAuthenticated: false })]);
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
