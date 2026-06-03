import cliPackageJson from "../../../../packages/cli/package.json";
import { describe, expect, it } from "vitest";

import { requiredCliVersion } from "./cli-version";

describe("requiredCliVersion", () => {
  it("comes from the CLI package.json version", () => {
    expect(requiredCliVersion).toBe(cliPackageJson.version);
  });
});
