// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SETUP_COMMAND, SetupCommandCopy, copySetupCommand } from "./setup-command-copy";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("copySetupCommand", () => {
  it("writes the setup command to the provided clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await copySetupCommand({ writeText });

    expect(writeText).toHaveBeenCalledWith("npx @blnayan/token-burn@latest setup");
  });

  it("throws when clipboard writing is unavailable", async () => {
    await expect(copySetupCommand(undefined)).rejects.toThrow("Clipboard copy is unavailable");
  });
});

describe("SetupCommandCopy", () => {
  it("renders the setup command in a read-only field", () => {
    render(<SetupCommandCopy />);

    const input = screen.getByLabelText("CLI setup command");
    expect(input).toHaveProperty("value", SETUP_COMMAND);
    expect(input).toHaveProperty("readOnly", true);
  });

  it("copies the setup command and shows copied state", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<SetupCommandCopy />);

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith(SETUP_COMMAND);
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    expect(screen.getByText("Setup command copied.")).toBeTruthy();
  });

  it("shows a manual-copy message when clipboard copy fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    render(<SetupCommandCopy />);

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.getByText("Could not copy command. Select it manually.")).toBeTruthy();
  });
});
