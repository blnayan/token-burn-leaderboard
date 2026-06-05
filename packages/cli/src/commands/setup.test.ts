import type { CliConfig } from "../config.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveOutputMode } from "../ui/mode.js";
import { createRenderer } from "../ui/renderer.js";
import type { UiRenderer } from "../ui/types.js";
import { runSetup } from "./setup.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.doUnmock("node:child_process");
  vi.doUnmock("../config.js");
});

describe("runSetup", () => {
  it("runs login, sync, and scheduler install in order when no reusable config exists", async () => {
    const events: string[] = [];
    const log = vi.fn();

    const calls: string[] = [];

    const result = await runSetup({
      serverUrl: "https://token-burn.test/",
      readConfig: async () => null,
      validateAuth: async () => {
        events.push("validate");
        return true;
      },
      login: async ({ serverUrl }) => {
        events.push(`login:${serverUrl}`);
      },
      sync: async () => {
        events.push("sync");
      },
      installScheduler: async ({ dryRun }) => {
        events.push(`install:${dryRun}`);
      },
      ui: createRecordingUi(calls),
    });

    expect(result).toEqual({ authReused: false, schedulerInstalled: true, syncFailed: false });
    expect(events).toEqual(["login:https://token-burn.test", "sync", "install:false"]);
    expect(calls).toContain("intro:Token Burn setup:1");
    expect(calls).toContain("step:auth:Checking authentication");
    expect(calls).toContain("success:sync:First sync complete");
    expect(calls).toContain("success:scheduler:Automatic sync will run on quarter-hour boundaries");
    expect(calls).toContain("summary:Setup complete:1");
    expect(readResultCall(calls)).toEqual({
      ok: true,
      authReused: false,
      schedulerInstalled: true,
      syncFailed: false,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("skips login and continues setup when same-server auth validates", async () => {
    const events: string[] = [];
    const login = vi.fn(async () => {
      events.push("login");
    });
    const validateAuth = vi.fn(async () => {
      events.push("validate");
      return true;
    });
    const log = vi.fn();

    const result = await runSetup({
      serverUrl: "https://token-burn.test///",
      readConfig: async () => config({ serverUrl: "https://token-burn.test/", token: "tok_valid" }),
      validateAuth,
      login,
      sync: async () => {
        events.push("sync");
      },
      installScheduler: async ({ dryRun }) => {
        events.push(`install:${dryRun}`);
      },
      log,
    });

    expect(result).toEqual({ authReused: true, schedulerInstalled: true, syncFailed: false });
    expect(validateAuth).toHaveBeenCalledWith({
      serverUrl: "https://token-burn.test",
      token: "tok_valid",
    });
    expect(login).not.toHaveBeenCalled();
    expect(events).toEqual(["validate", "sync", "install:false"]);
    expect(log).toHaveBeenCalledWith("OK: Existing authentication is valid");
    expect(log).not.toHaveBeenCalledWith("Login complete.");
  });

  it("runs login when same-server auth is rejected", async () => {
    const events: string[] = [];

    const result = await runSetup({
      serverUrl: "https://token-burn.test",
      readConfig: async () => config({ serverUrl: "https://token-burn.test", token: "tok_invalid" }),
      validateAuth: async () => {
        events.push("validate");
        return false;
      },
      login: async ({ serverUrl }) => {
        events.push(`login:${serverUrl}`);
      },
      sync: async () => {
        events.push("sync");
      },
      installScheduler: async ({ dryRun }) => {
        events.push(`install:${dryRun}`);
      },
      log: vi.fn(),
    });

    expect(result).toEqual({ authReused: false, schedulerInstalled: true, syncFailed: false });
    expect(events).toEqual(["validate", "login:https://token-burn.test", "sync", "install:false"]);
  });

  it("runs login without validation when config has no token", async () => {
    const validateAuth = vi.fn(async () => true);
    const login = vi.fn(async () => undefined);

    const result = await runSetup({
      serverUrl: "https://token-burn.test",
      readConfig: async () => config({ serverUrl: "https://token-burn.test", token: undefined }),
      validateAuth,
      login,
      sync: async () => undefined,
      installScheduler: async () => undefined,
      log: vi.fn(),
    });

    expect(result).toEqual({ authReused: false, schedulerInstalled: true, syncFailed: false });
    expect(validateAuth).not.toHaveBeenCalled();
    expect(login).toHaveBeenCalledWith({ serverUrl: "https://token-burn.test" });
  });

  it("runs login without validation when config server differs from the selected server", async () => {
    const validateAuth = vi.fn(async () => true);
    const login = vi.fn(async () => undefined);

    const result = await runSetup({
      serverUrl: "https://selected-token-burn.test/",
      readConfig: async () => config({ serverUrl: "https://saved-token-burn.test", token: "tok_saved" }),
      validateAuth,
      login,
      sync: async () => undefined,
      installScheduler: async () => undefined,
      log: vi.fn(),
    });

    expect(result).toEqual({ authReused: false, schedulerInstalled: true, syncFailed: false });
    expect(validateAuth).not.toHaveBeenCalled();
    expect(login).toHaveBeenCalledWith({ serverUrl: "https://selected-token-burn.test" });
  });

  it("propagates validation non-auth failures before sync or scheduler install", async () => {
    const sync = vi.fn(async () => undefined);
    const installScheduler = vi.fn(async () => undefined);

    await expect(
      runSetup({
        serverUrl: "https://token-burn.test",
        readConfig: async () => config({ serverUrl: "https://token-burn.test", token: "tok_valid" }),
        validateAuth: async () => {
          throw new Error("network unavailable");
        },
        login: async () => undefined,
        sync,
        installScheduler,
        log: vi.fn(),
      }),
    ).rejects.toThrow("network unavailable");

    expect(sync).not.toHaveBeenCalled();
    expect(installScheduler).not.toHaveBeenCalled();
  });

  it("stops when login fails", async () => {
    const sync = vi.fn(async () => undefined);
    const installScheduler = vi.fn(async () => undefined);

    await expect(
      runSetup({
        serverUrl: "https://token-burn.test",
        readConfig: async () => null,
        login: async () => {
          throw new Error("Login session expired before approval.");
        },
        sync,
        installScheduler,
        log: vi.fn(),
      }),
    ).rejects.toThrow("Login session expired before approval.");

    expect(sync).not.toHaveBeenCalled();
    expect(installScheduler).not.toHaveBeenCalled();
  });

  it("still attempts scheduler install when first sync fails after valid auth", async () => {
    const installScheduler = vi.fn(async () => undefined);
    const log = vi.fn();

    const result = await runSetup({
      serverUrl: "https://token-burn.test",
      readConfig: async () => config({ serverUrl: "https://token-burn.test", token: "tok_valid" }),
      validateAuth: async () => true,
      login: async () => undefined,
      sync: async () => {
        throw new Error("All supported providers failed: codex: fixture missing.");
      },
      installScheduler,
      log,
    });

    expect(result).toEqual({ authReused: true, schedulerInstalled: true, syncFailed: true });
    expect(installScheduler).toHaveBeenCalledWith({ dryRun: false });
    expect(log).toHaveBeenCalledWith(
      "Warning: First sync failed: All supported providers failed: codex: fixture missing.",
    );
    expect(log).toHaveBeenCalledWith(
      "Automatic sync was still installed or refreshed and will retry on quarter-hour boundaries.",
    );
  });

  it("reports scheduler install failure with existing retry guidance", async () => {
    await expect(
      runSetup({
        serverUrl: "https://token-burn.test",
        readConfig: async () => config({ serverUrl: "https://token-burn.test", token: "tok_valid" }),
        validateAuth: async () => true,
        login: async () => undefined,
        sync: async () => undefined,
        installScheduler: async () => {
          throw new Error("systemd user timer unavailable");
        },
        log: vi.fn(),
      }),
    ).rejects.toThrow(
      "Setup authenticated and attempted the first sync, but automatic sync was not installed: systemd user timer unavailable. Retry with npx @blnayan/token-burn@latest install-scheduler.",
    );
  });

  it("suppresses nested login results when setup renders JSON", async () => {
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      execFile: (_command: string, _args: string[], callback: (error: Error | null) => void) => {
        callback(null);
      },
    }));
    vi.doMock("../config.js", () => ({
      readConfig: vi.fn(async () => null),
      writeConfig: vi.fn(async () => undefined),
    }));

    const lines: string[] = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        loginUrl: "https://token-burn.test/cli/approve/ABCD-2345",
        pollToken: "poll-token",
        expiresAt: "2026-07-01T00:01:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: "approved",
        token: "tb_secret",
        member: { displayName: "Ada", username: "blnayan" },
      }));
    globalThis.fetch = fetch;

    const { runSetup: runSetupWithDefaultLogin } = await import("./setup.js");

    await runSetupWithDefaultLogin({
      serverUrl: "https://token-burn.test",
      sync: async () => undefined,
      installScheduler: async () => undefined,
      ui: createRenderer(resolveOutputMode({ flags: { json: true } }), { write: (line) => lines.push(line) }),
    });

    expect(lines).toEqual([
      JSON.stringify({ ok: true, authReused: false, schedulerInstalled: true, syncFailed: false }),
    ]);
  });
});

function config(overrides: Partial<CliConfig>): CliConfig {
  return {
    serverUrl: "https://token-burn.test",
    token: "tok_default",
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

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
