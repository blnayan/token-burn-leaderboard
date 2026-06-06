import { describe, expect, it } from "vitest";

import { resolveOutputMode } from "./mode.js";

describe("resolveOutputMode", () => {
  it("uses rich mode for an interactive terminal", () => {
    expect(resolveOutputMode({ stdoutIsTTY: true, env: {}, flags: {} })).toEqual({
      color: true,
      mode: "rich",
      quiet: false,
    });
  });

  it("uses plain mode for non-TTY output", () => {
    expect(resolveOutputMode({ stdoutIsTTY: false, env: {}, flags: {} })).toEqual({
      color: false,
      mode: "plain",
      quiet: false,
    });
  });

  it("uses plain mode when NO_COLOR is set", () => {
    expect(resolveOutputMode({ stdoutIsTTY: true, env: { NO_COLOR: "1" }, flags: {} })).toEqual({
      color: false,
      mode: "plain",
      quiet: false,
    });
  });

  it("honors --plain over interactive TTY", () => {
    expect(resolveOutputMode({ stdoutIsTTY: true, env: {}, flags: { plain: true } })).toEqual({
      color: false,
      mode: "plain",
      quiet: false,
    });
  });

  it("honors --json over --plain and TTY detection", () => {
    expect(resolveOutputMode({ stdoutIsTTY: false, env: {}, flags: { json: true, plain: true } })).toEqual({
      color: false,
      mode: "json",
      quiet: false,
    });
  });

  it("honors TOKEN_BURN_OUTPUT=json", () => {
    expect(resolveOutputMode({ stdoutIsTTY: true, env: { TOKEN_BURN_OUTPUT: "json" }, flags: {} })).toEqual({
      color: false,
      mode: "json",
      quiet: false,
    });
  });

  it("honors TOKEN_BURN_OUTPUT=plain", () => {
    expect(resolveOutputMode({ stdoutIsTTY: true, env: { TOKEN_BURN_OUTPUT: "plain" }, flags: {} })).toEqual({
      color: false,
      mode: "plain",
      quiet: false,
    });
  });

  it("ignores unsupported TOKEN_BURN_OUTPUT values", () => {
    expect(resolveOutputMode({ stdoutIsTTY: false, env: { TOKEN_BURN_OUTPUT: "rich" }, flags: {} })).toEqual({
      color: false,
      mode: "plain",
      quiet: false,
    });
  });

  it("uses flags before TOKEN_BURN_OUTPUT", () => {
    expect(resolveOutputMode({ stdoutIsTTY: true, env: { TOKEN_BURN_OUTPUT: "json" }, flags: { plain: true } })).toEqual({
      color: false,
      mode: "plain",
      quiet: false,
    });
  });

  it("keeps rich layout without ANSI color for --no-color", () => {
    expect(resolveOutputMode({ stdoutIsTTY: true, env: {}, flags: { color: false } })).toEqual({
      color: false,
      mode: "rich",
      quiet: false,
    });
  });

  it("passes quiet mode through", () => {
    expect(resolveOutputMode({ stdoutIsTTY: true, env: {}, flags: { quiet: true } })).toEqual({
      color: true,
      mode: "rich",
      quiet: true,
    });
  });
});
