import type { PrismaClient } from "@prisma/client";
import { normalizeMerchantKey } from "@/domain/imports/category-rules";
import { LOCAL_RESOURCE_ID } from "./strategy";
import { TRAILING_WINDOW_MONTHS, type InsightMonthlyTotal, type InsightTransaction, type SpendingInsightsInput } from "./spending-insights";

/**
 * Loads the raw aggregates the pure `spending-insights` functions need, once.
 * Both `loadDashboardData` (Overview cards) and `assemblePortfolioContext`
 * (analysis-run narrative) go through here, so there is one computation with two
 * callers, and every Prisma `Decimal`/`Date` is flattened to a plain
 * number/string before it leaves this module.
 */

/**
 * `YYYY-MM-DD` in local time. Bank dates are date-only values stamped at
 * midnight, and the rest of the dashboard slices months with local getters, so
 * this stays consistent with `loadDashboardData`'s month ranges.
 */
function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildMonthlyTotals(transactions: InsightTransaction[]): InsightMonthlyTotal[] {
  const totals = new Map<string, number>();

  for (const transaction of transactions) {
    const key = `${transaction.date.slice(0, 7)}|${transaction.category}`;
    totals.set(key, (totals.get(key) ?? 0) + transaction.amount);
  }

  return Array.from(totals.entries()).map(([key, total]) => {
    const [month, category] = key.split("|");
    return { month, category, total };
  });
}

export async function loadSpendingInsightsInputs(
  db: PrismaClient,
  options: { now?: Date; resourceId?: string } = {}
): Promise<SpendingInsightsInput> {
  const now = options.now ?? new Date();
  const resourceId = options.resourceId ?? LOCAL_RESOURCE_ID;
  const windowStart = new Date(now.getFullYear(), now.getMonth() - TRAILING_WINDOW_MONTHS, 1);

  const [rows, earlierMerchants, budgets] = await Promise.all([
    // One indexed range scan over the trailing window. The per-month totals are
    // folded from these same rows rather than fetched by a second wave of
    // groupBy queries, because the anomaly rules need the rows anyway.
    db.bankTransaction.findMany({
      where: { direction: "OUTFLOW", operationDate: { gte: windowStart } },
      orderBy: [{ operationDate: "asc" }, { id: "asc" }],
      select: { id: true, operationDate: true, amount: true, category: true, merchant: true }
    }),
    db.bankTransaction.findMany({
      where: { operationDate: { lt: windowStart }, merchant: { not: null } },
      distinct: ["merchant"],
      select: { merchant: true }
    }),
    db.categoryBudget.findMany({ where: { resourceId }, orderBy: { category: "asc" } })
  ]);

  const transactions: InsightTransaction[] = rows.map((row) => ({
    id: row.id,
    date: dateKey(row.operationDate),
    amount: Math.abs(Number(row.amount)),
    category: row.category,
    merchant: row.merchant,
    merchantKey: normalizeMerchantKey(row.merchant)
  }));

  const knownMerchantKeys = Array.from(
    new Set(earlierMerchants.map((row) => normalizeMerchantKey(row.merchant)).filter((key): key is string => key !== null))
  );

  return {
    today: dateKey(now),
    monthlyTotals: buildMonthlyTotals(transactions),
    transactions,
    knownMerchantKeys,
    budgets: budgets.map((budget) => ({ category: budget.category, amount: Number(budget.amount) }))
  };
}
