import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { UiRenderer } from "../ui/types.js";
import { cliVersion } from "../version.js";
import { createStatusCommand, runStatus } from "./status.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("runStatus", () => {
  it("renders status with the provided renderer", async () => {
    const calls: string[] = [];

    await runStatus({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "tb_secret" }),
      serverClient: {
        readHealth: async () => ({ requiredCliVersion: cliVersion, serverTime: "2026-06-03T00:00:00.000Z" }),
      },
      ui: {
        intro: (title, details = []) => calls.push(`intro:${title}:${details.length}`),
        step: () => undefined,
        success: (_id, message) => calls.push(`success:${message}`),
        warning: () => undefined,
        info: (message) => calls.push(`info:${message}`),
        table: () => undefined,
        summary: () => undefined,
        nextAction: () => undefined,
        error: () => undefined,
        result: (result) => calls.push(`result:${JSON.stringify(result)}`),
      },
      log: () => undefined,
    });

    expect(calls).toContain("intro:Token Burn status:2");
    expect(calls).toContain("success:Authenticated with https://token-burn.test");
    expect(readResultCall(calls)).toEqual({
      ok: true,
      authenticated: true,
      cliVersion,
      requiredCliVersion: cliVersion,
      serverUrl: "https://token-burn.test",
    });
  });

  it("honors legacy log injection with the default plain renderer", async () => {
    const lines: string[] = [];

    await runStatus({
      readConfig: async () => null,
      log: (message) => lines.push(message),
    });

    expect(lines).toContain("Token Burn status");
    expect(lines).toContain("Auth: not authenticated");
    expect(lines).toContain("Not authenticated.");
    expect(lines).not.toContain(JSON.stringify({ ok: true, authenticated: false, cliVersion }));
  });

  it("honors parent --json output flags in the command action", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "token-burn-status-"));
    const write = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubEnv("TOKEN_BURN_CONFIG_DIR", configDir);

    try {
      const program = new Command()
        .name("token-burn")
        .option("--json")
        .exitOverride();
      program.addCommand(createStatusCommand());

      await program.parseAsync(["--json", "status"], { from: "user" });
    } finally {
      await rm(configDir, { force: true, recursive: true });
    }

    expect(write.mock.calls).toEqual([[JSON.stringify({ ok: true, authenticated: false, cliVersion })]]);
  });

  it("renders logged-in server and last sync when present", async () => {
    const calls: string[] = [];
    const serverRequiredCliVersion = createDifferentVersion(cliVersion);

    const result = await runStatus({
      readConfig: async () => ({
        serverUrl: "https://token-burn.test",
        token: "tb_secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        lastSync: {
          ok: true,
          message: "Synced 42 tokens",
          at: "2026-06-01T00:00:00.000Z",
        },
      }),
      serverClient: {
        readHealth: async () => ({
          requiredCliVersion: serverRequiredCliVersion,
          serverTime: "2026-06-03T00:00:00.000Z",
        }),
      },
      ui: createRecordingUi(calls),
    });

    expect(result.requiredCliVersion).toBe(serverRequiredCliVersion);
    expect(result.device).toEqual({ id: "4f43b27d-7d86-4ff8-8c98-f74158819e59", name: "nayan-vps" });
    expect(result.lastSync).toEqual({
      ok: true,
      message: "Synced 42 tokens",
      at: "2026-06-01T00:00:00.000Z",
    });
    expect(calls).toContain("intro:Token Burn status:2");
    expect(calls).toContain("success:auth:Authenticated with https://token-burn.test");
    expect(calls).toContain("info:Device: nayan-vps (4f43b27d-7d86-4ff8-8c98-f74158819e59)");
    expect(calls).toContain("info:Last sync: OK - Synced 42 tokens at 2026-06-01T00:00:00.000Z");
    expect(calls).toContain(
      `warning:version:Token Burn requires token-burn ${serverRequiredCliVersion}. You have ${cliVersion}. Run npm install -g @blnayan/token-burn@latest.`,
    );
  });

  it("keeps local status useful when server health fails", async () => {
    const calls: string[] = [];

    const result = await runStatus({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "tb_secret" }),
      serverClient: {
        readHealth: async () => {
          throw new Error("network down");
        },
      },
      ui: createRecordingUi(calls),
    });

    expect(result.serverHealthError).toBe("network down");
    expect(calls).toContain("success:auth:Authenticated with https://token-burn.test");
    expect(calls).toContain("warning:health:Server health check failed: network down");
  });

  it("reports remembered server when config has no token", async () => {
    const calls: string[] = [];

    const result = await runStatus({
      readConfig: async () => ({ serverUrl: "https://token-burn.test" }),
      ui: createRecordingUi(calls),
    });

    expect(result.rememberedServer).toBe("https://token-burn.test");
    expect(calls).toContain("warning:auth:Not authenticated");
    expect(calls).toContain("info:Remembered server: https://token-burn.test");
  });

  it("reports tokenless last sync and returns it for renderers", async () => {
    const calls: string[] = [];

    const result = await runStatus({
      readConfig: async () => ({
        serverUrl: "https://token-burn.test",
        lastSync: { ok: false, message: "Failed providers: claude_code", at: "2026-06-01T00:00:00.000Z" },
      }),
      ui: createRecordingUi(calls),
    });

    expect(calls).toContain("warning:auth:Not authenticated");
    expect(calls).toContain("info:Remembered server: https://token-burn.test");
    expect(calls).toContain("info:Last sync: Failed - Failed providers: claude_code at 2026-06-01T00:00:00.000Z");
    expect(result).toEqual({
      authenticated: false,
      cliVersion,
      lastSync: { ok: false, message: "Failed providers: claude_code", at: "2026-06-01T00:00:00.000Z" },
      rememberedServer: "https://token-burn.test",
      serverUrl: "https://token-burn.test",
    });
  });

  it("returns structured status for renderers", async () => {
    const result = await runStatus({
      readConfig: async () => ({
        serverUrl: "https://token-burn.test",
        token: "tb_secret",
        deviceId: "device-1",
        deviceName: "nayan-vps",
        lastSync: { ok: true, message: "Submitted 42 usage rows.", at: "2026-06-01T00:00:00.000Z" },
      }),
      serverClient: {
        readHealth: async () => ({
          requiredCliVersion: cliVersion,
          serverTime: "2026-06-03T00:00:00.000Z",
        }),
      },
      ui: createRecordingUi([]),
    });

    expect(result).toEqual({
      authenticated: true,
      cliVersion,
      device: { id: "device-1", name: "nayan-vps" },
      lastSync: { ok: true, message: "Submitted 42 usage rows.", at: "2026-06-01T00:00:00.000Z" },
      rememberedServer: undefined,
      requiredCliVersion: cliVersion,
      serverHealthError: undefined,
      serverUrl: "https://token-burn.test",
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

function createDifferentVersion(version: string): string {
  const major = Number(version.split(".")[0] ?? 0);

  return `${major + 1}.0.0`;
}
