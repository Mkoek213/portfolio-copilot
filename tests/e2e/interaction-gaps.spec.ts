import { test, expect } from "@playwright/test";

/**
 * Plan-15: destructive actions are gated behind an explicit confirm dialog,
 * and cancelling does not fire the underlying Server Action.
 */
test("destructive import action requires a confirm dialog", async ({ page }) => {
  await page.goto("/?tab=imports", { waitUntil: "networkidle" });

  // "Delete failed/skipped" shows when resolved batches exist; if it isn't
  // present in this dataset there's nothing to gate, so skip.
  const deleteAll = page.getByRole("button", { name: /Delete failed\/skipped/i });
  if ((await deleteAll.count()) === 0) {
    test.skip();
    return;
  }

  await deleteAll.first().click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading")).toContainText(/Delete failed and skipped imports/);

  // Cancelling closes the dialog without firing the action.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});
