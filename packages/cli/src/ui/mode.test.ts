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
