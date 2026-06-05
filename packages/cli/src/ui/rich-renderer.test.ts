import { describe, expect, it, vi } from "vitest";

import { createRichRenderer } from "./rich-renderer.js";

describe("createRichRenderer", () => {
  it("writes Clean Operator output without color when color is false", () => {
    const write = vi.fn();
    const ui = createRichRenderer({ color: false, write });

    ui.intro("Token Burn", [{ label: "Mode", value: "setup" }]);
    ui.success("auth", "Authenticated as nayan");
    ui.table("Devices", {
      columns: ["ID", "Name"],
      rows: [["device-1", "nayan-vps"]],
    });
    ui.error({ code: "AUTH_REQUIRED", message: "Run token-burn login.", nextAction: "token-burn login" });

    expect(write.mock.calls.map(([line]) => line)).toEqual([
      "Token Burn",
      "  Mode  setup",
      "✓ Authenticated as nayan",
      "Devices",
      "ID        Name",
      "device-1  nayan-vps",
      "x Run token-burn login.",
      "  Next  token-burn login",
    ]);
  });

  it("does not write machine-readable results in human output", () => {
    const write = vi.fn();
    const ui = createRichRenderer({ color: false, write });

    ui.result({ ok: true, submitted: 42 });

    expect(write).not.toHaveBeenCalled();
  });
});
