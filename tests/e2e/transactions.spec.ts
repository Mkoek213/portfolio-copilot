import { test, expect } from "@playwright/test";
import { normalizeMerchantKey } from "../../src/domain/imports/category-rules";
import { prisma, E2E_RESOURCE_ID } from "./db";

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

/**
 * Plan-19 learned categorization: a row auto-categorized from a learned rule
 * shows the "nauczone" marker; overriding its category clears the marker (source
 * flips to "user") AND last-write-wins updates the rule. Seeds/cleans its own
 * data via Prisma so it never depends on the local dataset.
 */
const LEARNED_MARKER = '[aria-label="Kategoria nauczona z Twoich wcześniejszych poprawek"]';

test("learned category shows a marker, overriding clears it and updates the rule", async ({ page }) => {
  const suffix = Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 8) || "abcd";
  const merchant = `E2E LEARNED SHOP ${suffix}`;
  const matchKey = normalizeMerchantKey(merchant);
  expect(matchKey, "seed merchant must produce a clean rule key").not.toBeNull();

  const batch = await prisma.importBatch.create({
    data: { provider: "MBANK_EMAIL", source: "GMAIL_MCP", gmailMessageId: `e2e-learned-${suffix}`, status: "IMPORTED", transactionCount: 1 }
  });
  const transaction = await prisma.bankTransaction.create({
    data: {
      importBatchId: batch.id,
      // An old date keeps this row out of the unfiltered "first row" the sibling
      // CategorySelect test grabs; the merchant filter still surfaces it here.
      operationDate: new Date("2000-01-02T00:00:00.000Z"),
      amount: "42.00",
      currency: "PLN",
      direction: "OUTFLOW",
      description: `ZAKUP PRZY UŻYCIU KARTY; ${merchant}`,
      merchant,
      category: "food",
      categorySource: "learned"
    }
  });
  const rule = await prisma.categoryRule.create({
    data: { resourceId: E2E_RESOURCE_ID, matchKey: matchKey!, direction: "OUTFLOW", category: "food" }
  });

  try {
    await page.goto(`/?tab=transactions&merchant=${encodeURIComponent(merchant)}`, { waitUntil: "networkidle" });

    const select = page.locator('select[aria-label="Transaction category"]').first();
    await expect(select).toHaveValue("food");
    await expect(page.locator(LEARNED_MARKER)).toBeVisible();

    // Override the learned category.
    await select.selectOption("shopping");
    await expect(page.locator('select[aria-label="Transaction category"]').first()).toHaveValue("shopping");

    // A full reload reflects the persisted state: value sticks, marker is gone.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator('select[aria-label="Transaction category"]').first()).toHaveValue("shopping");
    await expect(page.locator(LEARNED_MARKER)).toHaveCount(0);

    // The correction flipped provenance to "user" and last-write-wins the rule.
    const updatedTransaction = await prisma.bankTransaction.findUnique({ where: { id: transaction.id } });
    expect(updatedTransaction?.category).toBe("shopping");
    expect(updatedTransaction?.categorySource).toBe("user");

    const updatedRule = await prisma.categoryRule.findUnique({
      where: { resourceId_matchKey_direction: { resourceId: E2E_RESOURCE_ID, matchKey: matchKey!, direction: "OUTFLOW" } }
    });
    expect(updatedRule?.category).toBe("shopping");
  } finally {
    await prisma.bankTransaction.deleteMany({ where: { importBatchId: batch.id } });
    await prisma.categoryRule.deleteMany({ where: { id: rule.id } });
    await prisma.importBatch.delete({ where: { id: batch.id } });
    await prisma.$disconnect();
  }
});
