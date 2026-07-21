import type { PrismaClient } from "@prisma/client";
import { buildAllocation, roundMoney, roundPercent } from "./calculations";
import { getOrCreateStrategySettings, getOrCreateUserFinancialProfile, strategyFromSettings } from "./strategy";
import type { AllocationItem, PortfolioContext, PositionSnapshot, TransactionSnapshot } from "./types";

function buildCategoryAllocation(transactions: TransactionSnapshot[], totalOutflow: number): AllocationItem[] {
  const totals = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.direction !== "OUTFLOW") {
      continue;
    }

    totals.set(transaction.category, (totals.get(transaction.category) ?? 0) + Math.abs(transaction.amount));
  }

  return Array.from(totals.entries())
    .map(([key, value]) => ({
      key,
      label: key,
      value: roundMoney(value),
      percent: totalOutflow > 0 ? roundPercent((value / totalOutflow) * 100) : 0
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
}

function startOfCurrentMonth(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function recentWindow(now: Date, days: number) {
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  return date;
}

export async function assemblePortfolioContext(db: PrismaClient): Promise<PortfolioContext> {
  const now = new Date();
  const currentMonthStart = startOfCurrentMonth(now);
  const recentStart = recentWindow(now, 90);

  const [rows, strategySettings, financialProfile, transactions, imports, reports, observations, reflections] = await Promise.all([
    db.position.findMany({
      include: {
        account: true,
        asset: true
      },
      orderBy: [{ marketValueBase: "desc" }]
    }),
    getOrCreateStrategySettings(db),
    getOrCreateUserFinancialProfile(db),
    db.bankTransaction.findMany({
      where: { operationDate: { gte: recentStart } },
      orderBy: [{ operationDate: "desc" }, { id: "desc" }],
      take: 200
    }),
    db.importBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 12
    }),
    db.report.findMany({
      orderBy: { createdAt: "desc" },
      take: 8
    }),
    db.observation.findMany({
      where: { resourceId: "local-user" },
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    db.reflection.findMany({
      where: { resourceId: "local-user" },
      orderBy: { createdAt: "desc" },
      take: 5
    })
  ]);
  const strategy = strategyFromSettings(strategySettings, financialProfile);

  const totalValue = rows.reduce((sum, row) => sum + Number(row.marketValueBase), 0);

  const positions: PositionSnapshot[] = rows.map((row) => {
    const marketValueBase = Number(row.marketValueBase);

    return {
      accountName: row.account.name,
      provider: row.account.provider,
      symbol: row.asset.symbol,
      name: row.asset.name,
      assetClass: row.asset.assetClass,
      currency: row.currency,
      sector: row.asset.sector,
      quantity: Number(row.quantity),
      marketPrice: Number(row.marketPrice),
      marketValueBase,
      weight: totalValue > 0 ? roundPercent((marketValueBase / totalValue) * 100) : 0
    };
  });

  const transactionSnapshots: TransactionSnapshot[] = transactions.map((transaction) => ({
    id: transaction.id,
    operationDate: transaction.operationDate,
    amount: Number(transaction.amount),
    currency: transaction.currency,
    direction: transaction.direction,
    description: transaction.description,
    merchant: transaction.merchant,
    category: transaction.category,
    accountLabel: transaction.accountLabel
  }));

  const currentMonthTransactions = transactionSnapshots.filter((transaction) => transaction.operationDate >= currentMonthStart);
  const monthlyInflow = roundMoney(
    currentMonthTransactions
      .filter((transaction) => transaction.direction === "INFLOW")
      .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0)
  );
  const monthlyOutflow = roundMoney(
    currentMonthTransactions
      .filter((transaction) => transaction.direction === "OUTFLOW")
      .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0)
  );

  const missingData = [
    rows.length === 0 ? "Brak pozycji portfelowych. Seed lub integracja portfela nie dostarczyły danych." : null,
    transactionSnapshots.length === 0 ? "Brak historii transakcji bankowych z mBank/Gmail." : null,
    imports.length === 0 ? "Brak historii importów Gmail mBank." : null,
    "Brak zewnętrznych snapshotów rynkowych i źródeł web research w tej iteracji."
  ].filter((item): item is string => Boolean(item));

  const dataSourcesUsed = [
    rows.length > 0 ? "sample-data:accounts-assets-positions" : null,
    transactionSnapshots.length > 0 ? "bank-transactions:mbank-email" : null,
    imports.length > 0 ? "imports:gmail-api" : null,
    observations.length > 0 || reflections.length > 0 ? "memory:observations-reflections" : null,
    reports.length > 0 ? "reports:history" : null
  ].filter((item): item is string => Boolean(item));

  return {
    asOf: now,
    baseCurrency: strategy.baseCurrency,
    totalValue: roundMoney(totalValue),
    positions,
    transactions: transactionSnapshots,
    spendingSummary: {
      currentMonth: currentMonthStart.toISOString().slice(0, 7),
      monthlyInflow,
      monthlyOutflow,
      netCashflow: roundMoney(monthlyInflow - monthlyOutflow),
      topCategories: buildCategoryAllocation(currentMonthTransactions, monthlyOutflow),
      recentTransactionCount: transactionSnapshots.length
    },
    imports: imports.map((batch) => ({
      id: batch.id,
      status: batch.status,
      subject: batch.subject,
      operationDate: batch.operationDate,
      transactionCount: batch.transactionCount,
      errorMessage: batch.errorMessage,
      createdAt: batch.createdAt
    })),
    reports: reports.map((report) => ({
      id: report.id,
      title: report.title,
      summary: report.summary,
      reportType: report.reportType,
      criticVerdict: report.criticVerdict,
      reporterSource: report.reporterSource,
      reporterModel: report.reporterModel,
      createdAt: report.createdAt
    })),
    memory: {
      observations: observations.map((observation) => ({
        id: observation.id,
        priority: observation.priority,
        topic: observation.topic,
        content: observation.content,
        createdAt: observation.createdAt
      })),
      reflections: reflections.map((reflection) => ({
        id: reflection.id,
        summary: reflection.summary,
        topics: reflection.topics,
        createdAt: reflection.createdAt
      }))
    },
    allocationByClass: buildAllocation(positions, totalValue, (position) => position.assetClass),
    allocationByCurrency: buildAllocation(positions, totalValue, (position) => position.currency),
    allocationByPosition: buildAllocation(
      positions,
      totalValue,
      (position) => position.symbol,
      (position) => `${position.symbol} - ${position.name}`
    ),
    missingData,
    dataSourcesUsed,
    strategy
  };
}
