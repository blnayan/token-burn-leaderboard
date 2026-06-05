import { describe, expect, it, vi } from "vitest";

import { resolveOutputMode } from "../ui/mode.js";
import { createRenderer } from "../ui/renderer.js";
import type { UiRenderer } from "../ui/types.js";
import { runInstallScheduler, runUninstallScheduler } from "./scheduler.js";

describe("runInstallScheduler", () => {
  it("renders dry-run scheduler output as info", async () => {
    const calls: string[] = [];

    await runInstallScheduler({
      dryRun: true,
      platform: "linux",
      syncCommandArgv: ["token-burn", "sync"],
      ui: createRecordingUi(calls),
    });

    expect(calls[0]).toContain("info:");
    expect(calls[0]).toContain("token-burn-sync.service");
  });

  it("renders dry-run scheduler output as JSON", async () => {
    const lines: string[] = [];

    const result = await runInstallScheduler({
      dryRun: true,
      platform: "linux",
      syncCommandArgv: ["token-burn", "sync"],
      ui: createRenderer(resolveOutputMode({ flags: { json: true } }), { write: (line) => lines.push(line) }),
    });

    expect(result.dryRun).toBe(true);
    expect(result.output).toContain("token-burn-sync.service");
    expect(lines).toEqual([JSON.stringify({ ok: true, dryRun: true, output: result.output })]);
  });

  it("renders install output as a scheduler success", async () => {
    const calls: string[] = [];
    const install = vi.fn(async () => "Installed Token Burn cron entry.");

    await runInstallScheduler({
      dryRun: false,
      platform: "linux",
      syncCommandArgv: ["token-burn", "sync"],
      install,
      ui: createRecordingUi(calls),
    });

    expect(install).toHaveBeenCalledWith("linux", ["token-burn", "sync"]);
    expect(calls).toContain("success:scheduler:Installed Token Burn cron entry.");
  });

  it("renders install output as JSON", async () => {
    const lines: string[] = [];
    const install = vi.fn(async () => "Installed Token Burn cron entry.");

    const result = await runInstallScheduler({
      dryRun: false,
      platform: "linux",
      syncCommandArgv: ["token-burn", "sync"],
      install,
      ui: createRenderer(resolveOutputMode({ flags: { json: true } }), { write: (line) => lines.push(line) }),
    });

    expect(result).toEqual({ dryRun: false, output: "Installed Token Burn cron entry." });
    expect(lines).toEqual([JSON.stringify({ ok: true, dryRun: false, output: "Installed Token Burn cron entry." })]);
  });
});

describe("runUninstallScheduler", () => {
  it("renders uninstall output as a scheduler success", async () => {
    const calls: string[] = [];
    const uninstall = vi.fn(async () => "Removed Token Burn scheduler.");

    await runUninstallScheduler({ platform: "linux", uninstall, ui: createRecordingUi(calls) });

    expect(uninstall).toHaveBeenCalledWith("linux");
    expect(calls).toContain("success:scheduler:Removed Token Burn scheduler.");
  });

  it("does not emit structured results through legacy log fallback", async () => {
    const messages: string[] = [];
    const uninstall = vi.fn(async () => "Removed Token Burn scheduler.");

    await runUninstallScheduler({
      platform: "linux",
      uninstall,
      log: (message) => messages.push(message),
    });

    expect(messages).toEqual(["OK: Removed Token Burn scheduler."]);
  });

  it("renders uninstall output as JSON", async () => {
    const lines: string[] = [];
    const uninstall = vi.fn(async () => "Removed Token Burn scheduler.");

    const result = await runUninstallScheduler({
      platform: "linux",
      uninstall,
      ui: createRenderer(resolveOutputMode({ flags: { json: true } }), { write: (line) => lines.push(line) }),
    });

    expect(result).toEqual({ output: "Removed Token Burn scheduler." });
    expect(lines).toEqual([JSON.stringify({ ok: true, output: "Removed Token Burn scheduler." })]);
  });
});

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
