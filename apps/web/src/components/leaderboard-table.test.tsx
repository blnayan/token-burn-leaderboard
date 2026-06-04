// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { LeaderboardTable } from "./leaderboard-table";

describe("LeaderboardTable", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows cost as a USD-formatted leaderboard column", () => {
    render(
      <LeaderboardTable
        rows={[
          {
            rank: 1,
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
});
