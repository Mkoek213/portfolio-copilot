import type { PrismaClient, ReportType } from "@prisma/client";
import type { AnalysisResult } from "@/domain/portfolio/types";
import { analysePortfolio } from "@/domain/agents/analyst";
import { buildLocalLlmReportDraft, summarizeLocalReporterPayload, type LocalReporterPayloadLimits } from "@/domain/agents/local-llm-reporter";
import { critiqueReport } from "@/domain/agents/report-critic";
import { buildReportDraft, type ReportDraft } from "@/domain/agents/reporter";
import { reviewRisks } from "@/domain/agents/risk-reviewer";
import { analyseSpending } from "@/domain/agents/spending-analyst";
import { planStrategyAdjustments } from "@/domain/agents/strategy-planner";
import { assemblePortfolioContext } from "@/domain/portfolio/context-assembler";
import { writeBudgetBreachObservations, writeObservationMemory } from "@/domain/memory/observational-memory";
import { traceStep } from "@/domain/tracing/local-tracing";
import { isLocalLlmReporterEnabled } from "@/lib/llm/local-llm-client";

const DEFAULT_THREAD_ID = "manual-review";
const DEFAULT_RESOURCE_ID = "local-user";

export type ReporterSource = "deterministic" | "local-gemma";

export type RunPortfolioAnalysisOptions = {
  llmModel?: string;
  reportType?: ReportType;
};

type BuildWorkflowReportInput = {
  context: Awaited<ReturnType<typeof assemblePortfolioContext>>;
  analystResult: Omit<AnalysisResult, "riskFlags">;
  riskFlags: ReturnType<typeof reviewRisks>;
  llmReporterEnabled: boolean;
  llmModel?: string;
  localReporter?: typeof buildLocalLlmReportDraft;
};

function unique(values: string[]) {
  return Array.from(new Set(values));
}

async function event(
  db: PrismaClient,
  runId: string,
  step: string,
  message: string,
  options: { level?: "INFO" | "WARN" | "ERROR"; metadata?: unknown } = {}
) {
  return db.runEvent.create({
    data: {
      runId,
      step,
      level: options.level ?? "INFO",
      message,
      metadata: options.metadata === undefined ? undefined : JSON.parse(JSON.stringify(options.metadata))
    }
  });
}

export async function buildWorkflowReportDraft({
  context,
  analystResult,
  riskFlags,
  llmReporterEnabled,
  llmModel,
  localReporter = buildLocalLlmReportDraft
}: BuildWorkflowReportInput): Promise<{
  reportDraft: ReportDraft;
  reporterSource: ReporterSource;
  reporterModel: string | null;
  warning: string | null;
  contextLimits: LocalReporterPayloadLimits;
}> {
  const deterministicReport = buildReportDraft(context, analystResult, riskFlags);
  const contextLimits = summarizeLocalReporterPayload(context);

  if (!llmReporterEnabled) {
    return {
      reportDraft: deterministicReport,
      reporterSource: "deterministic",
      reporterModel: null,
      warning: null,
      contextLimits
    };
  }

  const localReport = await localReporter(context, analystResult, riskFlags, llmModel);

  if (!localReport.success) {
    return {
      reportDraft: deterministicReport,
      reporterSource: "deterministic",
      reporterModel: llmModel ?? null,
      warning: localReport.error,
      contextLimits
    };
  }

  return {
    reportDraft: localReport.report,
    reporterSource: "local-gemma",
    reporterModel: localReport.model,
    warning: null,
    contextLimits
  };
}

export async function runPortfolioAnalysis(db: PrismaClient, options: RunPortfolioAnalysisOptions = {}) {
  const run = await db.agentRun.create({
    data: {
      threadId: DEFAULT_THREAD_ID,
      resourceId: DEFAULT_RESOURCE_ID,
      status: "RUNNING"
    }
  });
  const traceId = run.id;

  try {
    await event(db, run.id, "context-assembler", "Starting local context assembly.");
    const context = await traceStep(db, { traceId, runId: run.id, resourceId: run.resourceId, name: "context-assembler" }, () =>
      assemblePortfolioContext(db)
    );

    await event(db, run.id, "spending-analyst", "Analysing spending, cashflow and transaction categories.", {
      metadata: { transactions: context.transactions.length, monthlyOutflow: context.spendingSummary.monthlyOutflow }
    });
    const spendingResult = await traceStep(db, { traceId, runId: run.id, resourceId: run.resourceId, name: "spending-analyst" }, () =>
      analyseSpending(context)
    );

    await event(db, run.id, "portfolio-analyst", "Analysing allocation, concentration, opportunities and missing data.", {
      metadata: { totalValue: context.totalValue, positions: context.positions.length }
    });
    const portfolioResult = await traceStep(db, { traceId, runId: run.id, resourceId: run.resourceId, name: "portfolio-analyst" }, () =>
      analysePortfolio(context)
    );

    await event(db, run.id, "risk-reviewer", "Reviewing spending, investment and missing-data risks.");
    const baseRiskFlags = await traceStep(db, { traceId, runId: run.id, resourceId: run.resourceId, name: "risk-reviewer" }, () =>
      reviewRisks(context)
    );
    const riskFlags = [...spendingResult.riskFlags, ...baseRiskFlags];

    const analystResult: Omit<AnalysisResult, "riskFlags"> = {
      summary: [spendingResult.summary, portfolioResult.summary].join(" "),
      opportunities: [...spendingResult.opportunities, ...portfolioResult.opportunities],
      recommendations: [...spendingResult.recommendations, ...portfolioResult.recommendations],
      rebalancingPlan: portfolioResult.rebalancingPlan,
      unknowns: unique([...context.missingData, ...spendingResult.unknowns, ...portfolioResult.unknowns])
    };

    await event(db, run.id, "strategy-planner", "Comparing local profile, goals and tolerances with current findings.");
    const strategyPlan = await traceStep(db, { traceId, runId: run.id, resourceId: run.resourceId, name: "strategy-planner" }, () =>
      planStrategyAdjustments(context, { ...analystResult, riskFlags })
    );

    if (strategyPlan.suggestions.length > 0) {
      await db.strategySuggestion.createMany({
        data: strategyPlan.suggestions.map((suggestion) => ({
          resourceId: run.resourceId,
          sourceRunId: run.id,
          title: suggestion.title,
          rationale: suggestion.rationale,
          metadata: { priority: suggestion.priority }
        }))
      });
      analystResult.recommendations = [...strategyPlan.suggestions, ...analystResult.recommendations];
    }

    const reporterContextLimits = summarizeLocalReporterPayload(context);
    const { reportDraft, reporterSource, reporterModel, warning, contextLimits } = await traceStep(
      db,
      { traceId, runId: run.id, resourceId: run.resourceId, name: "reporter", metadata: { llmModel: options.llmModel, contextLimits: reporterContextLimits } },
      () =>
        buildWorkflowReportDraft({
          context,
          analystResult,
          riskFlags,
          llmReporterEnabled: isLocalLlmReporterEnabled(),
          llmModel: options.llmModel
        })
    );

    await event(
      db,
      run.id,
      "reporter",
      warning ? "Local Gemma reporter failed. Falling back to deterministic reporter." : `Report generated by ${reporterSource}.`,
      {
        level: warning ? "WARN" : "INFO",
        metadata: {
          reporter: reporterSource,
          model: reporterModel,
          warning,
          contextLimits
        }
      }
    );

    const critic = await traceStep(db, { traceId, runId: run.id, resourceId: run.resourceId, name: "report-critic" }, () =>
      critiqueReport(reportDraft)
    );

    await event(db, run.id, "report-critic", `Report critic verdict: ${critic.verdict}.`, {
      level: critic.verdict === "PASS" ? "INFO" : "WARN",
      metadata: { notes: critic.notes }
    });

    await traceStep(db, { traceId, runId: run.id, resourceId: run.resourceId, name: "portfolio-snapshot" }, () =>
      db.portfolioSnapshot.create({
        data: {
          sourceRunId: run.id,
          asOf: context.asOf,
          totalValueBase: context.totalValue,
          baseCurrency: context.baseCurrency,
          allocations: reportDraft.allocation
        }
      })
    );

    await db.report.create({
      data: {
        runId: run.id,
        reportType: options.reportType ?? "ON_DEMAND",
        title: reportDraft.title,
        summary: reportDraft.summary,
        allocation: reportDraft.allocation,
        riskFlags: reportDraft.riskFlags,
        opportunities: reportDraft.opportunities,
        recommendations: reportDraft.recommendations,
        rebalancingPlan: reportDraft.rebalancingPlan,
        unknowns: reportDraft.unknowns,
        sources: reportDraft.sources,
        criticVerdict: critic.verdict,
        markdown: reportDraft.markdown,
        reporterSource,
        reporterModel
      }
    });

    await event(db, run.id, "observer", "Writing observational memory and checking reflection threshold.");
    const memoryWrite = await traceStep(db, { traceId, runId: run.id, resourceId: run.resourceId, name: "observer-reflector" }, () =>
      writeObservationMemory(db, {
        runId: run.id,
        threadId: run.threadId,
        resourceId: run.resourceId,
        context,
        report: reportDraft,
        recommendations: reportDraft.recommendations,
        riskFlags
      })
    );

    // Budget alerts: one memory record per category over its cap this month,
    // deduped per category per month so repeated runs never spam the Memory tab.
    const breaches = await traceStep(db, { traceId, runId: run.id, resourceId: run.resourceId, name: "budget-alerts" }, () =>
      writeBudgetBreachObservations(db, {
        threadId: run.threadId,
        resourceId: run.resourceId,
        month: context.spendingInsights.months.current,
        currency: context.baseCurrency,
        breaches: context.spendingInsights.budgets.filter((budget) => budget.status === "over")
      })
    );

    if (breaches.written.length > 0 || breaches.skipped.length > 0) {
      await event(db, run.id, "budget-alerts", `Budget breaches written: ${breaches.written.length}, already recorded this month: ${breaches.skipped.length}.`, {
        level: breaches.written.length > 0 ? "WARN" : "INFO",
        metadata: { written: breaches.written, skipped: breaches.skipped }
      });
    }

    await event(db, run.id, "reflector", memoryWrite.reflection ? "Reflection created after threshold." : "Reflection threshold not reached.");

    return db.agentRun.update({
      where: { id: run.id },
      data: {
        status: critic.verdict === "PASS" ? "COMPLETED" : "NEEDS_REVIEW",
        completedAt: new Date(),
        inputSummary: {
          dataSourcesUsed: context.dataSourcesUsed,
          missingData: context.missingData,
          transactions: context.transactions.length,
          imports: context.imports.length
        },
        outputSummary: {
          reportTitle: reportDraft.title,
          riskFlagCount: riskFlags.length,
          recommendationCount: reportDraft.recommendations.length,
          criticVerdict: critic.verdict,
          reporterSource,
          reporterModel,
          reportType: options.reportType ?? "ON_DEMAND",
          contextLimits
        }
      },
      include: {
        report: true
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown analysis error";

    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: message
      }
    });

    await event(db, run.id, "workflow", message, { level: "ERROR" });

    throw error;
  }
}
