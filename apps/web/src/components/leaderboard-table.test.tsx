// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const memberUsageDialogMock = vi.hoisted(() =>
  vi.fn(
    ({
      member,
      open,
      onOpenChange,
    }: {
      member: { username: string; displayName: string; rank: number } | null;
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }) =>
      open && member ? (
        <div
          data-testid="member-usage-dialog"
          data-display-name={member.displayName}
          data-open={String(open)}
          data-rank={String(member.rank)}
          data-username={member.username}
        >
          <button onClick={() => onOpenChange(false)}>Close details</button>
        </div>
      ) : null,
  ),
);

vi.mock("./member-usage-dialog", () => ({
  MemberUsageDialog: memberUsageDialogMock,
}));

import { LeaderboardTable } from "./leaderboard-table";

describe("LeaderboardTable", () => {
  afterEach(() => {
    cleanup();
    memberUsageDialogMock.mockClear();
  });

  it("shows cost as a USD-formatted leaderboard column", () => {
    render(
      <LeaderboardTable
        period="daily"
        rows={[
          {
            rank: 1,
            username: "ada",
            displayName: "Ada",
            totalTokens: 12400,
            totalCostUsd: 1234.5,
          },
        ]}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Cost" })).toBeTruthy();

    const row = screen.getByRole("row", { name: /#1 Ada 12.4K/ });
    expect(within(row).getByText("$1,234.50")).toBeTruthy();
  });

  it("opens member usage details for the selected leaderboard row", async () => {
    const user = userEvent.setup();

    render(
      <LeaderboardTable
        period="weekly"
        rows={[
          {
            rank: 1,
            username: "ada",
            displayName: "Ada",
            totalTokens: 12400,
            totalCostUsd: 1234.5,
          },
          {
            rank: 2,
            username: "grace",
            displayName: "Grace",
            totalTokens: 8000,
            totalCostUsd: 12.5,
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open usage details for Ada" }));

    const dialog = screen.getByTestId("member-usage-dialog");
    expect(dialog.getAttribute("data-open")).toBe("true");
    expect(dialog.getAttribute("data-username")).toBe("ada");
    expect(dialog.getAttribute("data-display-name")).toBe("Ada");
    expect(dialog.getAttribute("data-rank")).toBe("1");
  });
});
