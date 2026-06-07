import { expect, test } from "@playwright/test";

test("public leaderboard renders without authentication", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Token Burn" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Daily" })).toBeVisible();
  await expect(page.getByText(/No tokens burned yet|Tokens/)).toBeVisible();
});

test("member usage details open from a leaderboard row when data exists", async ({ page }) => {
  await page.goto("/");

  const usageDetailTriggers = page.getByRole("button", { name: /Open usage details for/i });
  const triggerCount = await usageDetailTriggers.count();

  test.skip(triggerCount === 0, "No seeded leaderboard rows available in this environment");

  await usageDetailTriggers.first().click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Usage trend")).toBeVisible();
});
