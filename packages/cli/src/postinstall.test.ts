import { chmod, mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fixCcusageNativeBinaryPermissions } from "./postinstall.js";

describe("fixCcusageNativeBinaryPermissions", () => {
  it("marks installed ccusage native binaries executable", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "token-burn-postinstall-"));
    const binaryPath = join(
      rootDir,
      "node_modules",
      "@ccusage",
      "ccusage-linux-x64",
      "bin",
      "ccusage",
    );
    await mkdir(join(binaryPath, ".."), { recursive: true });
    await writeFile(binaryPath, "#!/bin/sh\n");
    await chmod(binaryPath, 0o644);

    const fixed = await fixCcusageNativeBinaryPermissions({ rootDir, platform: "linux" });

    expect(fixed).toEqual([binaryPath]);
    expect((await stat(binaryPath)).mode & 0o111).toBe(0o111);
  });

  it("does nothing when optional ccusage native packages are not installed", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "token-burn-postinstall-"));

    await expect(fixCcusageNativeBinaryPermissions({ rootDir, platform: "linux" })).resolves.toEqual([]);
  });

  it("does nothing on Windows", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "token-burn-postinstall-"));

    await expect(fixCcusageNativeBinaryPermissions({ rootDir, platform: "win32" })).resolves.toEqual([]);
  });
});
