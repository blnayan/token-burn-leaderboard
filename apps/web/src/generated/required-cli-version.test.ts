import cliPackageJson from "../../../../packages/cli/package.json";
import { describe, expect, it } from "vitest";

import { requiredCliVersion } from "./required-cli-version";

describe("requiredCliVersion", () => {
  it("is generated from the CLI package.json version", () => {
    expect(requiredCliVersion).toBe(cliPackageJson.version);
  });
});
