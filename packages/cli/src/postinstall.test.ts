import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runBuiltPostinstall } from "../postinstall.mjs";
import { runPostinstallCompatibilityHook } from "./postinstall.js";

describe("runPostinstallCompatibilityHook", () => {
  it("keeps the published postinstall entrypoint as a no-op", async () => {
    await expect(runPostinstallCompatibilityHook()).resolves.toBeUndefined();
  });
});

describe("runBuiltPostinstall", () => {
  it("no-ops when stale built output does not export the compatibility hook", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "token-burn-postinstall-"));
    const builtPostinstallPath = join(rootDir, "postinstall.mjs");
    await writeFile(
      builtPostinstallPath,
      'export async function fixCcusageNativeBinaryPermissions() { throw new Error("old hook should not run"); }\n',
    );

    await expect(runBuiltPostinstall(builtPostinstallPath)).resolves.toBeUndefined();
  });

  it("surfaces errors thrown by the built compatibility hook", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "token-burn-postinstall-"));
    const builtPostinstallPath = join(rootDir, "postinstall.mjs");
    await writeFile(
      builtPostinstallPath,
      'export async function runPostinstallCompatibilityHook() { throw new Error("hook failed"); }\n',
    );

    await expect(runBuiltPostinstall(builtPostinstallPath)).rejects.toThrow("hook failed");
  });
});
