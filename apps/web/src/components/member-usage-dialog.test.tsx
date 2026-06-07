// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemberUsageDialog } from "./member-usage-dialog";

vi.mock("./member-usage-charts", () => ({
  MemberUsageCharts: () => <div>Usage charts</div>,
}));

const detail = {
  member: {
    username: "ada",
    displayName: "Ada",
  },
  period: "7d",
  summary: {
    rank: 1,
    totalTokens: 12400,
    totalCostUsd: 12.34,
  },
  trend: [{ date: "2026-06-01", totalTokens: 12400, totalCostUsd: 12.34 }],
  providers: [{ provider: "codex", totalTokens: 12400, totalCostUsd: 12.34 }],
  models: [{ provider: "codex", modelName: "gpt-5", totalTokens: 12400, totalCostUsd: 12.34 }],
  devices: [{ deviceName: "Workstation", os: "linux", totalTokens: 12400, totalCostUsd: 12.34 }],
} as const;

describe("MemberUsageDialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("fetches member usage when opened and renders the member heading with token summary", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => detail,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemberUsageDialog
        member={{ username: "ada", displayName: "Ada", rank: 1 }}
        open
        onOpenChange={() => {}}
      />,
    );

    expect(screen.getByText("Loading member usage...")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/leaderboard/members/ada?range=7d");
    expect(screen.getByRole("tab", { name: "Past 7 days" }).getAttribute("data-state")).toBe("active");

    expect(await screen.findByRole("heading", { name: "Ada" })).toBeTruthy();

    expect(screen.getByText("Tokens")).toBeTruthy();
    expect(screen.getByText("12.4K")).toBeTruthy();
  });

  it("shows a retryable error state and recovers after retry", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "nope" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => detail,
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemberUsageDialog
        member={{ username: "ada", displayName: "Ada", rank: 1 }}
        open
        onOpenChange={() => {}}
      />,
    );

    expect(await screen.findByText("Could not load member usage.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("heading", { name: "Ada" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lets the dialog switch from Past 7 days to Past 30 days", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...detail, period: "30d" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemberUsageDialog
        member={{ username: "ada", displayName: "Ada", rank: 1 }}
        open
        onOpenChange={() => {}}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Ada" })).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "Past 30 days" }));

    expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/ada?range=30d");
    expect(screen.getByRole("tab", { name: "Past 30 days" }).getAttribute("data-state")).toBe("active");
  });
});
