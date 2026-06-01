import { expect, test } from "@playwright/test";

test("public leaderboard renders without authentication", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Token Burn" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Daily" })).toBeVisible();
  await expect(page.getByText(/No tokens burned yet|Tokens/)).toBeVisible();
});
