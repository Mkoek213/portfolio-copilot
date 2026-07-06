import type { AnalysisResult, PortfolioContext, Recommendation, RiskFlag } from "@/domain/portfolio/types";

export type ReportDraft = {
  title: string;
  summary: string;
  allocation: {
    byClass: PortfolioContext["allocationByClass"];
    byCurrency: PortfolioContext["allocationByCurrency"];
    byPosition: PortfolioContext["allocationByPosition"];
  };
  riskFlags: RiskFlag[];
  opportunities: AnalysisResult["opportunities"];
  recommendations: Recommendation[];
  rebalancingPlan: Recommendation[];
  unknowns: string[];
  sources: string[];
  markdown: string;
};

function lines<T>(items: T[], render: (item: T) => string, fallback: string) {
  return items.length > 0 ? items.map(render).join("\n") : fallback;
}

export function buildReportDraft(context: PortfolioContext, analysis: Omit<AnalysisResult, "riskFlags">, riskFlags: RiskFlag[]): ReportDraft {
  const runTimestamp = context.asOf.toISOString().replace("T", " ").slice(0, 19);
  const title = `Portfolio Copilot report - ${runTimestamp} UTC`;
  const riskLines = lines(riskFlags, (flag) => `- [${flag.level}] ${flag.message}`, "- Brak istotnych flag ryzyka w dostępnych danych.");
  const recommendationLines = lines(analysis.recommendations, (item) => `- ${item.title}: ${item.rationale}`, "- Brak rekomendacji w tym runie.");
  const opportunityLines = lines(analysis.opportunities, (item) => `- ${item.title}: ${item.rationale}`, "- Brak osobnych okazji w tym runie.");
  const unknownLines = lines(analysis.unknowns, (item) => `- ${item}`, "- Brak dodatkowych braków danych poza źródłami oznaczonymi w kontekście.");
  const goals = lines(context.strategy.goals, (goal) => `- ${goal}`, "- Brak zapisanych celów w profilu.");
  const topCategories = lines(
    context.spendingSummary.topCategories,
    (category) => `- ${category.label}: ${category.value.toLocaleString("pl-PL")} ${context.baseCurrency} (${category.percent}%)`,
    "- Brak wydatków z bieżącego miesiąca."
  );
  const memoryLines = lines(
    context.memory.reflections.slice(0, 3),
    (reflection) => `- ${reflection.summary}`,
    "- Brak refleksji pamięci wysokiego poziomu."
  );

  return {
    title,
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
    markdown: [
      `# ${title}`,
      "",
      "## Summary",
      analysis.summary,
      "",
      "## Profile fit",
      `Profil: ${context.strategy.lifeStage}, horyzont ${context.strategy.investmentHorizonYears} lat, tolerancja ryzyka ${context.strategy.riskTolerance}.`,
      goals,
      "",
      "## Spending",
      `Bieżący miesiąc: wpływy ${context.spendingSummary.monthlyInflow.toLocaleString("pl-PL")} ${context.baseCurrency}, wydatki ${context.spendingSummary.monthlyOutflow.toLocaleString("pl-PL")} ${context.baseCurrency}, cashflow ${context.spendingSummary.netCashflow.toLocaleString("pl-PL")} ${context.baseCurrency}.`,
      topCategories,
      "",
      "## Risk flags",
      riskLines,
      "",
      "## Opportunities",
      opportunityLines,
      "",
      "## Recommendations",
      recommendationLines,
      "",
      "## Rebalancing plan",
      lines(analysis.rebalancingPlan, (item) => `- ${item.title}: ${item.rationale}`, "- Brak planu rebalancingu bez dodatkowych danych."),
      "",
      "## Memory",
      memoryLines,
      "",
      "## What we do not know",
      unknownLines,
      "",
      "Read-only constraint: this report does not place orders, execute transfers, modify Gmail, or imply licensed investment advice."
    ].join("\n")
  };
}
