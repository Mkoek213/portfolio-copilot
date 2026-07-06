import type { AnalysisResult, PortfolioContext, RiskFlag } from "@/domain/portfolio/types";
import { chatWithLocalLlm, type LocalLlmChatMessage, type LocalLlmResult } from "@/lib/llm/local-llm-client";
import type { ReportDraft } from "./reporter";

const MAX_RECENT_TRANSACTIONS = 12;
const MAX_IMPORTS = 6;
const MAX_REPORTS = 2;
const DESCRIPTION_PREVIEW_LENGTH = 90;

type LocalLlmReporterResult =
  | {
      success: true;
      report: ReportDraft;
      model: string;
    }
  | {
      success: false;
      error: string;
    };

export type LocalReporterPayloadLimits = {
  recentTransactions: {
    total: number;
    included: number;
    omitted: number;
    cap: number;
  };
  imports: {
    total: number;
    included: number;
    omitted: number;
    cap: number;
  };
  reports: {
    total: number;
    included: number;
    omitted: number;
    cap: number;
  };
};

function limitInfo(total: number, cap: number) {
  const included = Math.min(total, cap);

  return {
    total,
    included,
    omitted: Math.max(total - included, 0),
    cap
  };
}

function preview(value: string, maxLength = DESCRIPTION_PREVIEW_LENGTH) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

export function summarizeLocalReporterPayload(context: PortfolioContext): LocalReporterPayloadLimits {
  return {
    recentTransactions: limitInfo(context.transactions.length, MAX_RECENT_TRANSACTIONS),
    imports: limitInfo(context.imports.length, MAX_IMPORTS),
    reports: limitInfo(context.reports.length, MAX_REPORTS)
  };
}

function formatAllocation(items: PortfolioContext["allocationByClass"]) {
  return items
    .slice(0, 4)
    .map((item) => `${item.key}:${item.percent}%/${item.value}`)
    .join(", ") || "none";
}

function compactList(values: string[], limit: number, maxLength = DESCRIPTION_PREVIEW_LENGTH) {
  return values
    .slice(0, limit)
    .map((value) => preview(value, maxLength))
    .join("; ") || "none";
}

function buildTransactionCategoryFacts(context: PortfolioContext) {
  const totals = new Map<string, number>();

  for (const transaction of context.transactions.slice(0, MAX_RECENT_TRANSACTIONS)) {
    if (transaction.direction !== "OUTFLOW") {
      continue;
    }

    totals.set(String(transaction.category), (totals.get(String(transaction.category)) ?? 0) + Math.abs(transaction.amount));
  }

  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([category, amount]) => `${category}:${Math.round(amount * 100) / 100}`)
    .join(", ") || "none";
}

function buildReporterFacts(
  context: PortfolioContext,
  analysis: Omit<AnalysisResult, "riskFlags">,
  riskFlags: RiskFlag[]
) {
  const limits = summarizeLocalReporterPayload(context);

  return [
    `asOf=${context.asOf.toISOString().slice(0, 10)}; currency=${context.baseCurrency}; totalValue=${context.totalValue}`,
    `profile=${context.strategy.lifeStage}; risk=${context.strategy.riskTolerance}; horizonYears=${context.strategy.investmentHorizonYears}`,
    `spending ${context.spendingSummary.currentMonth}: inflow=${context.spendingSummary.monthlyInflow}; outflow=${context.spendingSummary.monthlyOutflow}; net=${context.spendingSummary.netCashflow}; top=${formatAllocation(context.spendingSummary.topCategories)}`,
    `allocationByClass=${formatAllocation(context.allocationByClass)}; allocationByCurrency=${formatAllocation(context.allocationByCurrency)}`,
    `transactions=${context.transactions.length}; outflowCategories=${buildTransactionCategoryFacts(context)}`,
    `contextLimits=transactions ${limits.recentTransactions.included}/${limits.recentTransactions.total} omitted ${limits.recentTransactions.omitted}; imports ${limits.imports.included}/${limits.imports.total} omitted ${limits.imports.omitted}; reports ${limits.reports.included}/${limits.reports.total} omitted ${limits.reports.omitted}`,
    `analysis=${preview(analysis.summary, 220)}`,
    `recommendations=${compactList(analysis.recommendations.map((item) => item.title), 2, 70)}`,
    `risks=${compactList(riskFlags.map((flag) => `${flag.level}:${flag.topic}`), 4, 70)}`,
    `missing=${compactList([...context.missingData, ...analysis.unknowns], 5, 90)}`,
    `sources=${context.dataSourcesUsed.join(", ") || "none"}`
  ].join("\n");
}

export function buildLocalLlmReporterMessages(
  context: PortfolioContext,
  analysis: Omit<AnalysisResult, "riskFlags">,
  riskFlags: RiskFlag[]
): LocalLlmChatMessage[] {
  const languageInstruction =
    context.strategy.preferredReportLanguage === "pl"
      ? "Pisz po polsku."
      : "Write in the preferred report language from the profile.";
  const facts = buildReporterFacts(context, analysis, riskFlags);

  return [
    {
      role: "system",
      content: [
        "Jesteś lokalnym Reporterem w aplikacji Portfolio Copilot.",
        languageInstruction,
        "Działasz wyłącznie na lokalnym kontekście użytkownika i nie zakładasz dostępu do internetu.",
        "Użyj wyłącznie bloku FACTS, bez internetu i bez dopowiadania danych.",
        "Napisz krótki markdown, maksymalnie 90 słów.",
        "Nagłówki sekcji muszą być dokładnie: ## Summary, ## Spending, ## Risks, ## Next checks, ## Sources.",
        "Wspomnij omitted counts tylko wtedy, gdy są większe od 0.",
        "Nie podawaj instrukcji przelewów, kupna ani sprzedaży.",
        "Raport musi zawierać zdanie zaczynające się dokładnie od: Read-only constraint:"
      ].join(" ")
    },
    {
      role: "user",
      content: [
        "Wygeneruj finalny markdown raportu. Używaj tylko danych z FACTS.",
        "Jeśli brakuje danych, wpisz je w Next checks.",
        "FACTS:",
        facts
      ].join("\n\n")
    }
  ];
}

function normalizeMarkdownHeadings(markdown: string) {
  return markdown
    .replace(/^\*\*(Summary|Spending|Risks|Next checks|Sources)\*\*$/gim, "## $1")
    .replace(/^(Summary|Spending|Risks|Next checks|Sources)$/gim, "## $1");
}

function withSafetyFooter(markdown: string) {
  if (markdown.includes("Read-only constraint:")) {
    return markdown;
  }

  return [
    markdown.trim(),
    "",
    "Read-only constraint: this report does not place orders, execute transfers, modify Gmail, or imply licensed investment advice."
  ].join("\n");
}

export async function buildLocalLlmReportDraft(
  context: PortfolioContext,
  analysis: Omit<AnalysisResult, "riskFlags">,
  riskFlags: RiskFlag[],
  model?: string
): Promise<LocalLlmReporterResult> {
  const result: LocalLlmResult = await chatWithLocalLlm(buildLocalLlmReporterMessages(context, analysis, riskFlags), {
    model,
    timeoutMs: 55_000,
    numPredict: 120,
    temperature: 0.2
  });

  if (!result.success) {
    return {
      success: false,
      error: `${result.error.code}: ${result.error.message}`
    };
  }

  const runTimestamp = context.asOf.toISOString().replace("T", " ").slice(0, 19);

  return {
    success: true,
    model: result.model,
    report: {
      title: `Portfolio Copilot local Gemma report - ${runTimestamp} UTC`,
      summary: analysis.summary,
      allocation: {
        byClass: context.allocationByClass,
        byCurrency: context.allocationByCurrency,
        byPosition: context.allocationByPosition
      },
      riskFlags,
      opportunities: analysis.opportunities,
      recommendations: analysis.recommendations,
      rebalancingPlan: analysis.rebalancingPlan,
      unknowns: analysis.unknowns,
      sources: context.dataSourcesUsed,
      markdown: withSafetyFooter(normalizeMarkdownHeadings(result.content))
    }
  };
}
