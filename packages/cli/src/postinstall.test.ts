import { describe, expect, it } from "vitest";

import { runPostinstallCompatibilityHook } from "./postinstall.js";

describe("runPostinstallCompatibilityHook", () => {
  it("keeps the published postinstall entrypoint as a no-op", async () => {
    await expect(runPostinstallCompatibilityHook()).resolves.toBeUndefined();
  });
});
