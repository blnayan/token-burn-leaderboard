import { describe, expect, it } from "vitest";

import { createProgram } from "./index.js";

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
