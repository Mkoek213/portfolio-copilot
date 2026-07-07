import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { defaultStrategy, strategyFromSettings } from "@/domain/portfolio/strategy";
import { checkGmailMcpHealth } from "@/domain/imports/gmail-mcp-adapter";
import { ensureSchedulerState } from "@/domain/scheduler/daily-scheduler";
import { startInAppScheduler } from "@/domain/scheduler/in-app-scheduler";
import { getOrCreateGlobalChatThread } from "@/domain/chat/global-chat";
import { checkLocalLlmHealth, getLocalLlmConfig } from "@/lib/llm/local-llm-client";
import { LOCAL_LLM_MODEL_PRESETS } from "@/lib/llm/model-presets";
import { checkLocalLangfuseStatus } from "@/lib/tracing/langfuse-status";

export type SearchParams = Record<string, string | string[] | undefined>;

export type MonthlyCashflow = {
  month: string;
  inflow: number;
  outflow: number;
};

export type CategoryTotal = {
  category: string;
  value: number;
  percent: number;
};

export function param(params: SearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function dateFromParam(value: string, endOfDay = false) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function numberFromParam(value: string) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildTransactionWhere(params: SearchParams): Prisma.BankTransactionWhereInput {
  const where: Prisma.BankTransactionWhereInput = {};
  const dateFrom = dateFromParam(param(params, "dateFrom"));
  const dateTo = dateFromParam(param(params, "dateTo"), true);
  const category = param(params, "category");
  const direction = param(params, "direction");
  const merchant = param(params, "merchant");
  const amountMin = numberFromParam(param(params, "amountMin"));
  const amountMax = numberFromParam(param(params, "amountMax"));

  if (dateFrom || dateTo) {
    where.operationDate = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {})
    };
  }

  if (category) {
    where.category = category;
  }

  if (direction === "INFLOW" || direction === "OUTFLOW") {
    where.direction = direction;
  }

  if (merchant) {
    where.OR = [
      { merchant: { contains: merchant, mode: "insensitive" } },
      { description: { contains: merchant, mode: "insensitive" } }
    ];
  }

  if (amountMin !== null || amountMax !== null) {
    where.amount = {
      ...(amountMin !== null ? { gte: amountMin } : {}),
      ...(amountMax !== null ? { lte: amountMax } : {})
    };
  }

  return where;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function cashflowMonthRanges(now: Date, months: number) {
  return Array.from({ length: months }, (_, index) => {
    const offset = months - index - 1;
    const start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 1);

    return { month: monthKey(start), start, end };
  });
}

type DirectionTotals = Array<{ direction: "INFLOW" | "OUTFLOW"; _sum: { amount: Prisma.Decimal | null } }>;

function sumByDirection(directionTotals: DirectionTotals) {
  let inflow = 0;
  let outflow = 0;

  for (const group of directionTotals) {
    const amount = Number(group._sum.amount ?? 0);

    if (group.direction === "INFLOW") {
      inflow += amount;
    } else {
      outflow += amount;
    }
  }

  return { inflow, outflow };
}

function buildMonthlyCashflow(monthRanges: Array<{ month: string }>, groupedTotals: DirectionTotals[]): MonthlyCashflow[] {
  return monthRanges.map((range, index) => {
    const bucket: MonthlyCashflow = { month: range.month, inflow: 0, outflow: 0 };

    for (const group of groupedTotals[index] ?? []) {
      const amount = Number(group._sum.amount ?? 0);

      if (group.direction === "INFLOW") {
        bucket.inflow += amount;
      } else {
        bucket.outflow += amount;
      }
    }

    return bucket;
  });
}

function buildCategoryTotals(
  directionTotals: DirectionTotals,
  categoryTotals: Array<{ category: string; _sum: { amount: Prisma.Decimal | null } }>,
  maxCategories = 6
): { totals: CategoryTotal[]; monthlyOutflow: number; monthlyInflow: number } {
  const { inflow: monthlyInflow, outflow: monthlyOutflow } = sumByDirection(directionTotals);

  const sorted = categoryTotals.map((group) => [group.category, Number(group._sum.amount ?? 0)] as const).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, maxCategories);
  const rest = sorted.slice(maxCategories);
  const restValue = rest.reduce((sum, [, value]) => sum + value, 0);

  const totals: CategoryTotal[] = top.map(([category, value]) => ({
    category,
    value,
    percent: monthlyOutflow > 0 ? Math.round((value / monthlyOutflow) * 1000) / 10 : 0
  }));

  if (restValue > 0) {
    totals.push({
      category: "__rest__",
      value: restValue,
      percent: monthlyOutflow > 0 ? Math.round((restValue / monthlyOutflow) * 1000) / 10 : 0
    });
  }

  return { totals, monthlyOutflow, monthlyInflow };
}

export async function loadDashboardData(params: SearchParams) {
  const transactionWhere = buildTransactionWhere(params);

  try {
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthRanges = cashflowMonthRanges(now, 6);

    const [
      positions,
      latestSnapshot,
      snapshotHistory,
      latestReport,
      reports,
      observations,
      reflections,
      strategySettings,
      financialProfile,
      importBatches,
      transactions,
      suggestions,
      traceSpans,
      runCount,
      observationCount,
      monthlyCashflowGroups,
      currentMonthDirectionTotals,
      currentMonthCategoryTotals,
      filteredDirectionTotals,
      filteredCount,
      localLlmHealth,
      gmailHealth,
      langfuseStatus,
      schedulerState
    ] = await Promise.all([
      prisma.position.findMany({
        include: { account: true, asset: true },
        orderBy: { marketValueBase: "desc" }
      }),
      prisma.portfolioSnapshot.findFirst({ orderBy: { createdAt: "desc" } }),
      prisma.portfolioSnapshot.findMany({ orderBy: { createdAt: "desc" }, take: 60, select: { createdAt: true, totalValueBase: true } }),
      prisma.report.findFirst({ orderBy: { createdAt: "desc" }, include: { run: true } }),
      prisma.report.findMany({ orderBy: { createdAt: "desc" }, take: 16, include: { run: true } }),
      prisma.observation.findMany({ orderBy: { createdAt: "desc" }, take: 24 }),
      prisma.reflection.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
      prisma.strategySettings.findUnique({ where: { resourceId: defaultStrategy.resourceId } }),
      prisma.userFinancialProfile.findUnique({ where: { resourceId: defaultStrategy.resourceId } }),
      prisma.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 24, include: { transactions: true } }),
      prisma.bankTransaction.findMany({ where: transactionWhere, orderBy: { operationDate: "desc" }, take: 200, include: { importBatch: true } }),
      prisma.strategySuggestion.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
      prisma.traceSpan.findMany({ orderBy: { startedAt: "desc" }, take: 16 }),
      prisma.agentRun.count(),
      prisma.observation.count(),
      Promise.all(
        monthRanges.map((range) =>
          prisma.bankTransaction.groupBy({
            by: ["direction"],
            where: { operationDate: { gte: range.start, lt: range.end } },
            _sum: { amount: true }
          })
        )
      ),
      prisma.bankTransaction.groupBy({
        by: ["direction"],
        where: { operationDate: { gte: currentMonthStart, lt: currentMonthEnd } },
        _sum: { amount: true }
      }),
      prisma.bankTransaction.groupBy({
        by: ["category"],
        where: { operationDate: { gte: currentMonthStart, lt: currentMonthEnd }, direction: "OUTFLOW" },
        _sum: { amount: true }
      }),
      prisma.bankTransaction.groupBy({
        by: ["direction"],
        where: transactionWhere,
        _sum: { amount: true }
      }),
      prisma.bankTransaction.count({ where: transactionWhere }),
      checkLocalLlmHealth(),
      checkGmailMcpHealth(),
      checkLocalLangfuseStatus(),
      ensureSchedulerState(prisma)
    ]);

    snapshotHistory.reverse();

    const chatThread = await getOrCreateGlobalChatThread(prisma);
    const chatMessages = (
      await prisma.chatMessage.findMany({
        where: { threadId: chatThread.id },
        orderBy: { createdAt: "desc" },
        take: 80
      })
    ).reverse();

    const totalValue = positions.reduce((sum, position) => sum + Number(position.marketValueBase), 0);

    const snapshotAllocation = Array.isArray(latestSnapshot?.allocations)
      ? []
      : ((latestSnapshot?.allocations as { byClass?: Array<{ key: string; label: string; value: number; percent: number }> } | null)?.byClass ?? []);

    // Live allocation from positions keeps the overview useful before the first analysis run.
    const liveAllocation = (() => {
      const byClass = new Map<string, number>();

      for (const position of positions) {
        byClass.set(position.asset.assetClass, (byClass.get(position.asset.assetClass) ?? 0) + Number(position.marketValueBase));
      }

      return Array.from(byClass.entries())
        .map(([key, value]) => ({
          key,
          label: key,
          value,
          percent: totalValue > 0 ? Math.round((value / totalValue) * 1000) / 10 : 0
        }))
        .sort((a, b) => b.value - a.value);
    })();

    const allocationByClass = snapshotAllocation.length > 0 ? snapshotAllocation : liveAllocation;

    const { totals: topCategories, monthlyOutflow, monthlyInflow } = buildCategoryTotals(currentMonthDirectionTotals, currentMonthCategoryTotals);
    const monthlyCashflow = buildMonthlyCashflow(monthRanges, monthlyCashflowGroups);

    const { inflow: filteredInflow, outflow: filteredOutflow } = sumByDirection(filteredDirectionTotals);

    const configuredLocalLlmModel = getLocalLlmConfig().model;
    const localLlmModelPresets = LOCAL_LLM_MODEL_PRESETS.some((preset) => preset.model === configuredLocalLlmModel)
      ? LOCAL_LLM_MODEL_PRESETS
      : [
          ...LOCAL_LLM_MODEL_PRESETS,
          {
            key: "configured",
            label: "Configured",
            model: configuredLocalLlmModel,
            target: "Model configured through OLLAMA_MODEL."
          }
        ];

    startInAppScheduler();

    return {
      ready: true as const,
      positions,
      latestSnapshot,
      snapshotHistory,
      latestReport,
      reports,
      observations,
      reflections,
      strategy: strategyFromSettings(strategySettings, financialProfile),
      importBatches,
      transactions,
      suggestions,
      traceSpans,
      runCount,
      observationCount,
      totalValue,
      allocationByClass,
      allocationIsLive: snapshotAllocation.length === 0,
      monthlyOutflow,
      monthlyInflow,
      monthlyCashflow,
      topCategories,
      filteredInflow,
      filteredOutflow,
      filteredCount,
      localLlmHealth,
      gmailHealth,
      langfuseStatus,
      schedulerState,
      chatMessages,
      localLlmModelPresets,
      configuredLocalLlmModel
    };
  } catch (error) {
    return {
      ready: false as const,
      error: error instanceof Error ? error.message : "Unknown database error"
    };
  }
}

export type DashboardData = Extract<Awaited<ReturnType<typeof loadDashboardData>>, { ready: true }>;
