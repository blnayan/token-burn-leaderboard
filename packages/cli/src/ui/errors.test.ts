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
});
