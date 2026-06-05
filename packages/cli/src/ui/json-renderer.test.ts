import { describe, expect, it, vi } from "vitest";

import { createJsonRenderer } from "./json-renderer.js";

describe("createJsonRenderer", () => {
  it("writes only final result JSON", () => {
    const write = vi.fn();
    const ui = createJsonRenderer({ write });

    ui.step("sync", "Submitting usage totals");
    ui.result({ ok: true, submitted: 42 });

    expect(write.mock.calls.map(([line]) => line)).toEqual([
      JSON.stringify({ ok: true, submitted: 42 }),
    ]);
  });

  it("writes JSON errors", () => {
    const write = vi.fn();
    const ui = createJsonRenderer({ write });

    ui.error({ code: "AUTH_REQUIRED", message: "Run token-burn login to authenticate." });

    expect(write.mock.calls.map(([line]) => line)).toEqual([
      JSON.stringify({ ok: false, error: { code: "AUTH_REQUIRED", message: "Run token-burn login to authenticate." } }),
    ]);
  });
});
