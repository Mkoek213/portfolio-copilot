import { test, expect, type Page } from "@playwright/test";
import { prisma, E2E_RESOURCE_ID } from "./db";

/**
 * Plan-20 spending insights, end to end:
 * - a budget set in the Strategy tab persists across a full reload and shows up
 *   on the Overview budget card with a live status,
 * - a clearly anomalous seeded transaction reaches the Overview anomalies card
 *   with its rule chip.
 * Both tests seed and clean their own data via Prisma, so neither depends on
 * whatever the local database happens to hold.
 */

function card(page: Page, title: string) {
  return page.locator('[data-slot="card"]').filter({ hasText: title });
}

test("a category budget persists and drives the Overview budget card", async ({ page }) => {
  const existing = await prisma.categoryBudget.findUnique({
    where: { resourceId_category: { resourceId: E2E_RESOURCE_ID, category: "food" } }
  });

  try {
    await page.goto("/?tab=strategy", { waitUntil: "networkidle" });

    const input = page.locator('input[name="budget-food"]');
    await input.fill("4321");
    await page.getByRole("button", { name: /Save budgets/i }).click();
    await expect(page.getByRole("status").filter({ hasText: "Budgets saved." })).toBeVisible();

    // A full reload proves the value came back from the database, not from state.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator('input[name="budget-food"]')).toHaveValue("4321");

    await page.goto("/?tab=overview", { waitUntil: "networkidle" });
    const budgets = card(page, "Category budgets");
    await expect(budgets.getByText("jedzenie")).toBeVisible();
    await expect(budgets.getByText(/on track|near limit|over budget/)).toBeVisible();
    await expect(budgets.getByText(/\/ 4[  ]?321 PLN/)).toBeVisible();
  } finally {
    if (existing) {
      await prisma.categoryBudget.update({ where: { id: existing.id }, data: { amount: existing.amount } });
    } else {
      await prisma.categoryBudget.deleteMany({ where: { resourceId: E2E_RESOURCE_ID, category: "food" } });
    }
    await prisma.$disconnect();
  }
});

test("an anomalous transaction is flagged on the Overview anomalies card", async ({ page }) => {
  const suffix = Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 8) || "abcd";
  const merchant = `E2E ANOMALY SHOP ${suffix}`;
  const now = new Date();
  // Eight flat samples two months back give the category a baseline; the rule
  // needs at least that many before it may fire at all.
  const sampleDate = (day: number) => new Date(now.getFullYear(), now.getMonth() - 2, day);

  const batch = await prisma.importBatch.create({
    data: { provider: "MBANK_EMAIL", source: "GMAIL_MCP", gmailMessageId: `e2e-anomaly-${suffix}`, status: "IMPORTED", transactionCount: 9 }
  });

  try {
    await prisma.bankTransaction.createMany({
      data: [
        ...Array.from({ length: 8 }, (_, index) => ({
          importBatchId: batch.id,
          operationDate: sampleDate(index + 1),
          amount: "10.00",
          currency: "PLN",
          direction: "OUTFLOW" as const,
          description: "E2E baseline",
          merchant: "E2E BASELINE SHOP",
          category: "education"
        })),
        {
          importBatchId: batch.id,
          operationDate: now,
          amount: "99999.00",
          currency: "PLN",
          direction: "OUTFLOW" as const,
          description: "E2E anomaly",
          merchant,
          category: "education"
        }
      ]
    });

    await page.goto("/?tab=overview", { waitUntil: "networkidle" });

    const anomalies = card(page, "Unusual transactions");
    await expect(anomalies.getByText(merchant)).toBeVisible();
    await expect(anomalies.getByText("kwota odstająca").first()).toBeVisible();
  } finally {
    await prisma.bankTransaction.deleteMany({ where: { importBatchId: batch.id } });
    await prisma.importBatch.delete({ where: { id: batch.id } });
    await prisma.$disconnect();
  }
});
