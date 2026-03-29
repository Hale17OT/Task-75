import { expect, test } from "@playwright/test";

test("frontend smoke renders root page", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173");
  await expect(page.locator("body")).toBeVisible();
  await expect(page).toHaveTitle(/.+/);
});
