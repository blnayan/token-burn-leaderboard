import { describe, expect, it, vi } from "vitest";

import { createPlainRenderer } from "./plain-renderer.js";

describe("createPlainRenderer", () => {
  it("writes stable step and summary output", () => {
    const write = vi.fn();
    const ui = createPlainRenderer({ write });

    ui.intro("Token Burn setup", [{ label: "Server", value: "https://token-burn.test" }]);
    ui.step("auth", "Checking authentication");
    ui.success("auth", "Authenticated as nayan");
    ui.warning("sync", "Codex skipped: no usage found");
    ui.summary("Setup complete", [{ label: "Automatic sync", value: "Every 15 minutes" }]);
    ui.nextAction("Run token-burn status");

    expect(write.mock.calls.map(([line]) => line)).toEqual([
      "Token Burn setup",
      "Server: https://token-burn.test",
      "Checking authentication",
      "OK: Authenticated as nayan",
      "Warning: Codex skipped: no usage found",
      "Setup complete",
      "Automatic sync: Every 15 minutes",
      "Next: Run token-burn status",
    ]);
  });

  it("renders errors as plain text", () => {
    const write = vi.fn();
    const ui = createPlainRenderer({ write });

    ui.error({ code: "AUTH_REQUIRED", message: "Run token-burn login to authenticate.", nextAction: "token-burn login" });

    expect(write.mock.calls.map(([line]) => line)).toEqual([
      "Error: Run token-burn login to authenticate.",
      "Next: token-burn login",
    ]);
  });

  it("does not write machine-readable results in human output", () => {
    const write = vi.fn();
    const ui = createPlainRenderer({ write });

    ui.result({ ok: true, submitted: 42 });

    expect(write).not.toHaveBeenCalled();
  });

  it("omits nonessential output in quiet mode", () => {
    const write = vi.fn();
    const ui = createPlainRenderer({ quiet: true, write });

    ui.step("sync", "Submitting usage totals");
    ui.success("sync", "Submitted 42 usage rows");
    ui.error({ code: "SYNC_FAILED", message: "All providers failed." });

    expect(write.mock.calls.map(([line]) => line)).toEqual([
      "OK: Submitted 42 usage rows",
      "Error: All providers failed.",
    ]);
  });
});
