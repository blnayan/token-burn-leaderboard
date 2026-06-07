import { describe, expect, it } from "vitest";

import { memberUsageChartConfig } from "./member-usage-charts";

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
