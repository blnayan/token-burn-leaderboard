import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createProgram, isCliEntrypoint, renderCliError } from "./index.js";

describe("createProgram", () => {
  it("exposes global output flags in help", () => {
    const help = createProgram().helpInformation();

    expect(help).toContain("--plain");
    expect(help).toContain("--json");
    expect(help).toContain("--no-color");
    expect(help).toContain("--quiet");
  });

  it("registers grouped scheduler commands", () => {
    const help = createProgram().helpInformation();

    expect(help).toContain("scheduler");
  });
});

describe("isCliEntrypoint", () => {
  it("matches symlinked argv paths that point to the module path", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "token-burn-cli-entrypoint-"));
    const modulePath = join(fixtureDir, "index.js");
    const binDir = join(fixtureDir, "node_modules", ".bin");
    const binPath = join(binDir, "token-burn");

    writeFileSync(modulePath, "");
    mkdirSync(binDir, { recursive: true });
    symlinkSync(modulePath, binPath);

    expect(isCliEntrypoint(binPath, pathToFileURL(modulePath).href)).toBe(true);
  });

  it("does not match unrelated argv paths", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "token-burn-cli-entrypoint-"));
    const modulePath = join(fixtureDir, "index.js");
    const unrelatedPath = join(fixtureDir, "other.js");

    writeFileSync(modulePath, "");
    writeFileSync(unrelatedPath, "");

    expect(isCliEntrypoint(unrelatedPath, pathToFileURL(modulePath).href)).toBe(false);
  });

  it("handles missing argv paths", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "token-burn-cli-entrypoint-"));
    const modulePath = join(fixtureDir, "index.js");

    writeFileSync(modulePath, "");

    expect(isCliEntrypoint(undefined, pathToFileURL(modulePath).href)).toBe(false);
  });
});

describe("renderCliError", () => {
  it("writes JSON errors to stdout", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    renderCliError(new Error("Login required"), {
      flags: { json: true },
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    expect(stdout).toEqual([
      JSON.stringify({
        ok: false,
        error: {
          code: "CLI_ERROR",
          message: "Login required",
        },
      }),
    ]);
    expect(stderr).toEqual([]);
  });

  it("writes human errors to stderr", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    renderCliError(new Error("Login required"), {
      flags: { plain: true },
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    expect(stdout).toEqual([]);
    expect(stderr).toEqual(["Error: Login required"]);
  });
});
