import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { cliVersion } from "./version.js";

describe("cliVersion", () => {
  it("comes from the CLI package.json version", async () => {
    const raw = await readFile(new URL("../package.json", import.meta.url), "utf8");
    const packageJson = JSON.parse(raw) as { version: string };

    expect(cliVersion).toBe(packageJson.version);
  });
});
