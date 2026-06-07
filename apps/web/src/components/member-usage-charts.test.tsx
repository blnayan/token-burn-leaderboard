// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MemberUsageDetail } from "@token-burn/shared";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemberUsageCharts, memberUsageChartConfig } from "./member-usage-charts";

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
  trend: [],
  providers: [{ provider: "codex", totalTokens: 12400, totalCostUsd: 12.34 }],
  models: [{ provider: "codex", modelName: "gpt-5", totalTokens: 8400, totalCostUsd: 8.4 }],
  devices: [
    {
      deviceId: "device-1",
      deviceName: "Workstation",
      os: "linux",
      totalTokens: 4000,
      totalCostUsd: 3.94,
    },
  ],
} satisfies MemberUsageDetail;

describe("memberUsageChartConfig", () => {
  it("uses Tailwind blue theme values for token bars", () => {
    expect(memberUsageChartConfig.totalTokens).toMatchObject({
      label: "Tokens",
      theme: {
        light: "var(--color-blue-500)",
        dark: "var(--color-blue-400)",
      },
    });
  });
});

describe("MemberUsageCharts", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders breakdown rows as pressed buttons when selected", () => {
    render(
      <MemberUsageCharts
        detail={detail}
        selectedFilters={{
          providers: ["codex"],
          models: [{ provider: "codex", modelName: "gpt-5" }],
          devices: ["device-1"],
        }}
      />,
    );

    const providers = sectionForHeading("Providers");
    const models = sectionForHeading("Models");
    const devices = sectionForHeading("Devices");

    expect(within(providers).getByRole("button", { name: /Codex/ }).getAttribute("aria-pressed")).toBe("true");
    expect(within(models).getByRole("button", { name: /gpt-5/ }).getAttribute("aria-pressed")).toBe("true");
    expect(within(devices).getByRole("button", { name: /Workstation/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps breakdown row box styling stable when selected", () => {
    render(
      <MemberUsageCharts
        detail={{
          ...detail,
          providers: [
            { provider: "codex", totalTokens: 12400, totalCostUsd: 12.34 },
            { provider: "claude_code", totalTokens: 6200, totalCostUsd: 6.2 },
          ],
        }}
        selectedFilters={{
          providers: ["codex"],
          models: [],
          devices: [],
        }}
      />,
    );

    const providers = sectionForHeading("Providers");
    const selectedProvider = within(providers).getByRole("button", { name: /Codex/ });
    const unselectedProvider = within(providers).getByRole("button", { name: /Claude Code/ });

    expect(selectedProvider.getAttribute("data-selected")).toBe("true");
    expect(unselectedProvider.getAttribute("data-selected")).toBe("false");
    expect(selectedProvider.className).toContain("border");
    expect(unselectedProvider.className).toContain("border");
  });

  it("truncates long breakdown labels inside a bounded row", () => {
    const longModelName = "claude-haiku-4-5-20251001-extra-long-model-name-that-should-not-overlap";

    render(
      <MemberUsageCharts
        detail={{
          ...detail,
          models: [
            {
              provider: "claude_code",
              modelName: longModelName,
              totalTokens: 8400,
              totalCostUsd: 8.4,
            },
          ],
        }}
      />,
    );

    const modelButton = within(sectionForHeading("Models")).getByRole("button", { name: new RegExp(longModelName) });
    const modelLabel = screen.getByText(longModelName);
    const labelColumn = modelLabel.parentElement;

    expect(modelButton.className).toContain("whitespace-normal");
    expect(labelColumn?.className).toContain("flex-1");
    expect(labelColumn?.className).toContain("overflow-hidden");
    expect(modelLabel.className).toContain("max-w-full");
    expect(modelLabel.className).toContain("truncate");
  });

  it("renders unselected breakdown rows as unpressed buttons", () => {
    render(<MemberUsageCharts detail={detail} />);

    const providers = sectionForHeading("Providers");
    const models = sectionForHeading("Models");
    const devices = sectionForHeading("Devices");

    expect(within(providers).getByRole("button", { name: /Codex/ }).getAttribute("aria-pressed")).toBe("false");
    expect(within(models).getByRole("button", { name: /gpt-5/ }).getAttribute("aria-pressed")).toBe("false");
    expect(within(devices).getByRole("button", { name: /Workstation/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("uses filter-specific empty copy when selected filters have no trend rows", () => {
    render(
      <MemberUsageCharts
        detail={{ ...detail, trend: [] }}
        selectedFilters={{
          providers: ["codex"],
          models: [],
          devices: [],
        }}
      />,
    );

    expect(screen.getByText("No usage for these filters.")).toBeTruthy();
  });

  it("does not duplicate total cost in the trend heading", () => {
    render(<MemberUsageCharts detail={detail} />);

    expect(within(sectionForHeading("Token trend")).queryByText("$12.34")).toBeNull();
  });

  it("calls filter toggle callbacks with provider, model, and device identifiers", async () => {
    const user = userEvent.setup();
    const onToggleDevice = vi.fn();
    const onToggleModel = vi.fn();
    const onToggleProvider = vi.fn();

    render(
      <MemberUsageCharts
        detail={detail}
        onToggleDevice={onToggleDevice}
        onToggleModel={onToggleModel}
        onToggleProvider={onToggleProvider}
      />,
    );

    await user.click(within(sectionForHeading("Providers")).getByRole("button", { name: /Codex/ }));
    await user.click(within(sectionForHeading("Models")).getByRole("button", { name: /gpt-5/ }));
    await user.click(within(sectionForHeading("Devices")).getByRole("button", { name: /Workstation/ }));

    expect(onToggleProvider).toHaveBeenCalledWith("codex");
    expect(onToggleModel).toHaveBeenCalledWith({ provider: "codex", modelName: "gpt-5" });
    expect(onToggleDevice).toHaveBeenCalledWith("device-1");
  });
});

function sectionForHeading(name: string): HTMLElement {
  const section = screen.getByRole("heading", { name }).closest("section");
  expect(section).toBeTruthy();

  return section as HTMLElement;
}
