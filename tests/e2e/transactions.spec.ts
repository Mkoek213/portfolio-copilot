import { test, expect } from "@playwright/test";

/**
 * Plan-14 Transactions: the two must-not-regress behaviors.
 * - The filter is a real GET navigation (URL-is-state), not client routing.
 * - CategorySelect updates the row in place (controlled value + router.refresh)
 *   AND persists across a full reload (no stale-defaultValue). Self-cleaning:
 *   restores the original category at the end.
 */
test("transactions filter navigates via GET with query params", async ({ page }) => {
  await page.goto("/?tab=transactions", { waitUntil: "networkidle" });
  await page.locator('select[name="direction"]').selectOption("OUTFLOW");
  await page.getByRole("button", { name: /Filter/i }).click();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/[?&]direction=OUTFLOW/);
  await expect(page).toHaveURL(/[?&]tab=transactions/);
});

test("CategorySelect updates in place and persists across reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto("/?tab=transactions", { waitUntil: "networkidle" });
  const select = page.locator('select[aria-label="Transaction category"]').first();
  const original = await select.inputValue();
  const options = await select.locator("option").evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  const target = options.find((v) => v && v !== original) ?? original;

  await select.selectOption(target);
  await expect(page.locator('select[aria-label="Transaction category"]').first()).toHaveValue(target);

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator('select[aria-label="Transaction category"]').first()).toHaveValue(target);

  // restore
  await page.locator('select[aria-label="Transaction category"]').first().selectOption(original);
  await expect(page.locator('select[aria-label="Transaction category"]').first()).toHaveValue(original);

  expect(errors, errors.join("\n")).toHaveLength(0);
});
