import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createProgram, isCliEntrypoint } from "./index.js";

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
