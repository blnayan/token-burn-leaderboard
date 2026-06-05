import { describe, expect, it } from "vitest";

import { classifyError } from "./errors.js";

describe("classifyError", () => {
  it("classifies authentication guidance", () => {
    expect(classifyError(new Error("Run token-burn login --server-url https://tokenburn.nayanbhut.dev to authenticate."))).toEqual({
      code: "AUTH_REQUIRED",
      message: "Run token-burn login --server-url https://tokenburn.nayanbhut.dev to authenticate.",
      nextAction: "token-burn login",
    });
  });

  it("classifies CLI version mismatch", () => {
    expect(classifyError(new Error("Token Burn requires token-burn 2.0.0. You have 1.0.0. Run npm install -g @blnayan/token-burn@latest."))).toEqual({
      code: "CLI_VERSION_REQUIRED",
      message: "Token Burn requires token-burn 2.0.0. You have 1.0.0. Run npm install -g @blnayan/token-burn@latest.",
      nextAction: "npm install -g @blnayan/token-burn@latest",
    });
  });

  it("uses CLI_ERROR for unknown errors", () => {
    expect(classifyError(new Error("network down"))).toEqual({
      code: "CLI_ERROR",
      message: "network down",
    });
  });

  it("uses CLI_ERROR for plain string input", () => {
    expect(classifyError("network down")).toEqual({
      code: "CLI_ERROR",
      message: "network down",
    });
  });

  it("uses Unknown error when coercion throws", () => {
    const error = {
      toString() {
        throw new Error("cannot stringify");
      },
    };

    expect(classifyError(error)).toEqual({
      code: "CLI_ERROR",
      message: "Unknown error",
    });
  });

  it("classifies ccusage native binary permissions", () => {
    expect(classifyError(new Error("ccusage native binary is not executable at /usr/bin/ccusage"))).toEqual({
      code: "CCUSAGE_BINARY_PERMISSION",
      message: "ccusage native binary is not executable at /usr/bin/ccusage",
    });
  });

  it("classifies scheduler setup failures case-insensitively", () => {
    expect(classifyError(new Error("Automatic sync was not installed because launchd failed."))).toEqual({
      code: "SCHEDULER_ERROR",
      message: "Automatic sync was not installed because launchd failed.",
    });
  });

  it("does not classify unrelated scheduler metadata as a scheduler error", () => {
    expect(classifyError(new Error("provider scheduler metadata unavailable"))).toEqual({
      code: "CLI_ERROR",
      message: "provider scheduler metadata unavailable",
    });
  });

  it("does not classify unrelated words containing cron as scheduler errors", () => {
    expect(classifyError(new Error("provider acronym metadata unavailable"))).toEqual({
      code: "CLI_ERROR",
      message: "provider acronym metadata unavailable",
    });
  });

  it("classifies device merge and check failures", () => {
    expect(classifyError(new Error("Cannot merge devices with conflicting totals"))).toEqual({
      code: "DEVICE_ERROR",
      message: "Cannot merge devices with conflicting totals",
    });

    expect(classifyError(new Error("Device check failed: duplicate devices found"))).toEqual({
      code: "DEVICE_ERROR",
      message: "Device check failed: duplicate devices found",
    });
  });
});
