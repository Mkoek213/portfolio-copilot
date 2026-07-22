import type { PrismaClient } from "@prisma/client";
import type { PortfolioContext, Recommendation, RiskFlag } from "@/domain/portfolio/types";
import type { ReportDraft } from "@/domain/agents/reporter";

function intEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const REFLECTION_OBSERVATION_THRESHOLD = Math.max(4, Math.floor(intEnv("MEMORY_REFLECTION_TOKEN_THRESHOLD", 40_000) / 5_000));

export const BUDGET_BREACH_TOPIC = "budget-breach";

export async function writeObservationMemory(
  db: PrismaClient,
  input: {
    runId: string;
    threadId: string;
    resourceId: string;
    context: PortfolioContext;
    report: ReportDraft;
    recommendations: Recommendation[];
    riskFlags: RiskFlag[];
  }
) {
  const record = await db.observationRecord.create({
    data: {
      runId: input.runId,
      threadId: input.threadId,
      resourceId: input.resourceId,
      dataSourcesUsed: input.context.dataSourcesUsed,
      missingData: input.context.missingData,
      portfolioSnapshotSummary: {
        asOf: input.context.asOf.toISOString(),
        totalValue: input.context.totalValue,
        baseCurrency: input.context.baseCurrency,
        allocationByClass: input.context.allocationByClass,
        spendingSummary: input.context.spendingSummary
      },
      reportSummary: {
        title: input.report.title,
        summary: input.report.summary,
        criticVerdict: "stored-after-report-critic"
      },
      recommendations: input.recommendations,
      riskFlags: input.riskFlags
    }
  });

  const observationInputs = [
    {
      priority: "COMPLETED" as const,
      topic: "run-completed",
      content: `Run ${input.runId} zakończył raport ${input.report.title}.`
    },
    {
      priority: "HIGH" as const,
      topic: "strategy-profile",
      content: `Profil: ${input.context.strategy.lifeStage}, horyzont ${input.context.strategy.investmentHorizonYears} lat, tolerancja ${input.context.strategy.riskTolerance}, waluta ${input.context.strategy.baseCurrency}.`
    },
    {
      priority: "MEDIUM" as const,
      topic: "spending-summary",
      content: `Miesięczne wydatki ${input.context.spendingSummary.monthlyOutflow} ${input.context.baseCurrency}, wpływy ${input.context.spendingSummary.monthlyInflow} ${input.context.baseCurrency}.`
    },
    ...input.context.missingData.map((item) => ({
      priority: "MEDIUM" as const,
      topic: "missing-data",
      content: item
    })),
    ...input.riskFlags
      // Budget breaches are written by writeBudgetBreachObservations, which
      // dedupes per category per month; letting them through here as well would
      // add an undeduped copy on every run.
      .filter((flag) => flag.level !== "info" && flag.topic !== BUDGET_BREACH_TOPIC)
      .map((flag) => ({
        priority: "HIGH" as const,
        topic: flag.topic,
        content: flag.message
      }))
  ];

  await db.observation.createMany({
    data: observationInputs.map((observation) => ({
      ...observation,
      recordId: record.id,
      threadId: input.threadId,
      resourceId: input.resourceId,
      sourceLinks: {
        runId: input.runId,
        observationRecordId: record.id
      }
    }))
  });

  const reflection = await reflectIfNeeded(db, input.threadId, input.resourceId);

  return { record, reflection };
}

export async function writeImportObservation(
  db: PrismaClient,
  input: {
    resourceId: string;
    batchId?: string;
    topic: string;
    content: string;
    priority?: "HIGH" | "MEDIUM" | "LOW" | "COMPLETED";
  }
) {
  const observation = await db.observation.create({
    data: {
      threadId: "imports",
      resourceId: input.resourceId,
      priority: input.priority ?? "MEDIUM",
      topic: input.topic,
      content: input.content,
      sourceLinks: input.batchId ? { batchId: input.batchId } : undefined
    }
  });

  await reflectIfNeeded(db, "imports", input.resourceId);
  return observation;
}

/**
 * The per-category-per-month identity inside a breach observation's content.
 * Written into the content and matched when deduping, so repeated analysis runs
 * in the same month never spam memory with the same breach.
 */
export function budgetBreachMarker(category: string, month: string) {
  return `${category} (${month})`;
}

/**
 * Writes one `budget-breach` observation per category that is over its monthly
 * budget, at analysis-run time (plan 20). Deduped per category per month, so a
 * second run in the same month is a no-op. Follows the `writeImportObservation`
 * pattern: the breach shows up in the Memory tab and is available to chat and
 * future reports.
 */
export async function writeBudgetBreachObservations(
  db: PrismaClient,
  input: {
    threadId: string;
    resourceId: string;
    month: string;
    breaches: Array<{ category: string; spent: number; budget: number }>;
    currency?: string;
  }
) {
  if (input.breaches.length === 0) {
    return { written: [] as string[], skipped: [] as string[] };
  }

  const existing = await db.observation.findMany({
    where: { resourceId: input.resourceId, topic: BUDGET_BREACH_TOPIC, content: { contains: input.month } },
    select: { content: true }
  });

  const currency = input.currency ?? "PLN";
  const written: string[] = [];
  const skipped: string[] = [];
  const pending: typeof input.breaches = [];

  for (const breach of input.breaches) {
    const marker = budgetBreachMarker(breach.category, input.month);

    if (existing.some((observation) => observation.content.includes(marker))) {
      skipped.push(breach.category);
      continue;
    }

    written.push(breach.category);
    pending.push(breach);
  }

  if (pending.length > 0) {
    await db.observation.createMany({
      data: pending.map((breach) => ({
        threadId: input.threadId,
        resourceId: input.resourceId,
        priority: "MEDIUM" as const,
        topic: BUDGET_BREACH_TOPIC,
        content: `Budżet ${budgetBreachMarker(breach.category, input.month)} przekroczony: wydano ${breach.spent} ${currency} z ${breach.budget} ${currency}.`,
        sourceLinks: { month: input.month, category: breach.category }
      }))
    });
  }

  return { written, skipped };
}

export async function writeChatObservation(
  db: PrismaClient,
  input: {
    resourceId: string;
    threadId: string;
    userMessage: string;
    assistantMessage: string;
  }
) {
  const content = `Pytanie: ${input.userMessage.slice(0, 220)} | Odpowiedź: ${input.assistantMessage.slice(0, 320)}`;
  const observation = await db.observation.create({
    data: {
      threadId: input.threadId,
      resourceId: input.resourceId,
      priority: "LOW",
      topic: "chat",
      content,
      sourceLinks: { threadId: input.threadId }
    }
  });

  await reflectIfNeeded(db, input.threadId, input.resourceId);
  return observation;
}

export async function reflectIfNeeded(db: PrismaClient, threadId: string, resourceId: string) {
  const observations = await db.observation.findMany({
    where: { threadId, resourceId },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  if (observations.length < REFLECTION_OBSERVATION_THRESHOLD) {
    return null;
  }

  const latestReflection = await db.reflection.findFirst({
    where: { threadId, resourceId },
    orderBy: { createdAt: "desc" }
  });

  if (latestReflection && observations[0] && latestReflection.createdAt >= observations[0].createdAt) {
    return null;
  }

  const grouped = observations.reduce<Record<string, string[]>>((acc, observation) => {
    acc[observation.topic] = acc[observation.topic] ?? [];
    acc[observation.topic].push(observation.content);
    return acc;
  }, {});

  return db.reflection.create({
    data: {
      threadId,
      resourceId,
      summary: `Skonsolidowana pamięć z ${observations.length} obserwacji. Najważniejsze tematy: ${Object.keys(grouped).join(", ")}.`,
      topics: grouped,
      sourceObservationIds: observations.map((observation) => observation.id)
    }
  });
}
