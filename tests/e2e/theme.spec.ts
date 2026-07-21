import { test, expect } from "@playwright/test";

/**
 * Phase-12: the theme toggle flips `<html class="dark">` and next-themes
 * persists the choice across a reload (localStorage).
 */
test("theme toggle switches to dark and persists across reload", async ({ page }) => {
  await page.goto("/?tab=overview", { waitUntil: "networkidle" });

  const html = page.locator("html");
  await expect(html).not.toHaveClass(/\bdark\b/);

  // The sidebar toggle (topbar toggle is hidden above 920px).
  await page.locator("aside").getByRole("button", { name: "Toggle theme" }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();

  await expect(html).toHaveClass(/\bdark\b/);

  await page.reload({ waitUntil: "networkidle" });
  await expect(html).toHaveClass(/\bdark\b/);

  // And switching back to Light removes it.
  await page.locator("aside").getByRole("button", { name: "Toggle theme" }).click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  await expect(html).not.toHaveClass(/\bdark\b/);
});
