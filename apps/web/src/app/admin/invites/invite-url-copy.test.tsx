// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InviteUrlCopy, copyInviteUrl } from "./invite-url-copy";

const inviteUrl = "https://tokenburn.example.com/invite/abc123";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("copyInviteUrl", () => {
  it("writes the invite URL to the provided clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await copyInviteUrl(inviteUrl, { writeText });

    expect(writeText).toHaveBeenCalledWith(inviteUrl);
  });

  it("throws when clipboard writing is unavailable", async () => {
    await expect(copyInviteUrl(inviteUrl, undefined)).rejects.toThrow("Clipboard copy is unavailable");
  });
});

describe("InviteUrlCopy", () => {
  it("renders the invite URL in a read-only input", () => {
    render(<InviteUrlCopy inviteUrl={inviteUrl} />);

    const input = screen.getByLabelText("Invite URL");
    expect(input).toHaveProperty("value", inviteUrl);
    expect(input).toHaveProperty("readOnly", true);
  });

  it("copies the URL and shows copied state", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<InviteUrlCopy inviteUrl={inviteUrl} />);

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith(inviteUrl);
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    expect(screen.getByText("Invite link copied.")).toBeTruthy();
  });

  it("shows a failure message when clipboard copy fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    render(<InviteUrlCopy inviteUrl={inviteUrl} />);

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.getByText("Could not copy invite link. Select the URL manually.")).toBeTruthy();
  });
});
