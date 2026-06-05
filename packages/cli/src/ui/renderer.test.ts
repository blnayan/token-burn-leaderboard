import { describe, expect, it, vi } from "vitest";

import { createRenderer } from "./renderer.js";

describe("createRenderer", () => {
  it("creates a plain renderer", () => {
    const write = vi.fn();
    const ui = createRenderer({ color: false, mode: "plain", quiet: false }, { write });

    ui.success("sync", "Submitted 1 usage row");

    expect(write.mock.calls.map(([line]) => line)).toEqual(["OK: Submitted 1 usage row"]);
  });

  it("creates a json renderer", () => {
    const write = vi.fn();
    const ui = createRenderer({ color: false, mode: "json", quiet: false }, { write });

    ui.result({ ok: true });

    expect(write.mock.calls.map(([line]) => line)).toEqual([JSON.stringify({ ok: true })]);
  });
});
