import type { AnalysisResult, Opportunity, PortfolioContext, Recommendation, RiskFlag } from "@/domain/portfolio/types";
import { ANOMALY_RULE_LABELS } from "@/domain/portfolio/spending-insights";

const NON_ESSENTIAL_CATEGORIES = new Set(["subscriptions", "entertainment", "shopping"]);

// A month-over-month category move below this PLN amount is noise, not a finding.
const MATERIAL_CATEGORY_DELTA = 300;

// How far the projected current-month pace may run above the last completed
// month before it is worth flagging.
const PACE_WARNING_MULTIPLIER = 1.15;

function amount(value: number, currency: string) {
  return `${value.toLocaleString("pl-PL")} ${currency}`;
}

export function analyseSpending(context: PortfolioContext): Pick<AnalysisResult, "summary" | "opportunities" | "recommendations" | "riskFlags" | "unknowns"> {
  const flags: RiskFlag[] = [];
  const recommendations: Recommendation[] = [];
  const opportunities: Opportunity[] = [];
  const { monthlyIncome, monthlyFixedCosts, monthlyInvestmentCapacity } = context.strategy;
  const { monthlyOutflow, monthlyInflow, netCashflow, topCategories } = context.spendingSummary;
  const largestCategory = topCategories[0];
  const nonEssential = topCategories
    .filter((category) => NON_ESSENTIAL_CATEGORIES.has(category.key))
    .reduce((sum, category) => sum + category.value, 0);

  if (context.transactions.length === 0) {
    flags.push({
      level: "info",
      topic: "spending-data",
      message: "Brak zaimportowanych transakcji, więc analiza wydatków ogranicza się do braków danych."
    });
  }

  if (monthlyIncome != null && monthlyOutflow > monthlyIncome) {
    flags.push({
      level: "critical",
      topic: "negative-cashflow",
      message: "Wydatki z bieżącego miesiąca przekraczają zadeklarowany miesięczny dochód.",
      metric: monthlyOutflow - monthlyIncome
    });
  }

  if (monthlyFixedCosts != null && monthlyOutflow > monthlyFixedCosts * 1.35) {
    flags.push({
      level: "warning",
      topic: "variable-spending",
      message: "Wydatki są wyraźnie wyższe niż zadeklarowane stałe koszty, warto sprawdzić kategorie zmienne.",
      metric: monthlyOutflow - monthlyFixedCosts
    });
  }

  if (largestCategory && largestCategory.percent > 45) {
    flags.push({
      level: "warning",
      topic: "category-concentration",
      message: `Kategoria ${largestCategory.label} dominuje wydatki w tym miesiącu.`,
      metric: largestCategory.percent
    });
  }

  if (nonEssential > 0) {
    opportunities.push({
      title: "Przejrzyj wydatki uznaniowe",
      rationale: `Kategorie subscriptions, entertainment i shopping sumują się do ${nonEssential.toLocaleString("pl-PL")} ${context.baseCurrency} w bieżącym miesiącu.`,
      confidence: "medium"
    });
  }

  // Deterministic plan-20 insights: the numbers are already computed, the
  // analyst only turns them into flags the reporter can narrate.
  const { deltas, pace, anomalies, budgets } = context.spendingInsights;
  const topIncrease = deltas.find((delta) => delta.delta > 0);
  const overBudget = budgets.filter((budget) => budget.status === "over");
  const nearBudget = budgets.filter((budget) => budget.status === "near");

  if (topIncrease && topIncrease.delta >= MATERIAL_CATEGORY_DELTA) {
    flags.push({
      level: "warning",
      topic: "category-delta",
      message: `Kategoria ${topIncrease.category} wzrosła o ${amount(topIncrease.delta, context.baseCurrency)} między ${context.spendingInsights.months.priorCompleted} a ${context.spendingInsights.months.lastCompleted}.`,
      metric: topIncrease.delta
    });
  }

  if (pace.previousTotal > 0 && pace.projected > pace.previousTotal * PACE_WARNING_MULTIPLIER) {
    flags.push({
      level: "warning",
      topic: "spending-pace",
      message: `Prognozowane tempo wydatków w ${pace.month} to ${amount(pace.projected, context.baseCurrency)} wobec ${amount(pace.previousTotal, context.baseCurrency)} w ${pace.previousMonth}. To projekcja z ${pace.dayOfMonth} z ${pace.daysInMonth} dni, nie zamknięty miesiąc.`,
      metric: pace.projected - pace.previousTotal
    });
  }

  for (const budget of overBudget) {
    flags.push({
      level: "warning",
      topic: "budget-breach",
      message: `Budżet kategorii ${budget.category} przekroczony: ${amount(budget.spent, context.baseCurrency)} z ${amount(budget.budget, context.baseCurrency)}.`,
      metric: budget.spent - budget.budget
    });
  }

  if (nearBudget.length > 0) {
    flags.push({
      level: "info",
      topic: "budget-near",
      message: `Blisko limitu: ${nearBudget.map((budget) => budget.category).join(", ")}.`,
      metric: nearBudget.length
    });
  }

  if (anomalies.length > 0) {
    const notable = anomalies[0];

    flags.push({
      level: "info",
      topic: "spending-anomaly",
      message: `Oznaczono ${anomalies.length} nietypowych transakcji. Największa: ${notable.merchant ?? notable.category} na ${amount(notable.amount, context.baseCurrency)} (${notable.rules.map((rule) => ANOMALY_RULE_LABELS[rule]).join(", ")}).`,
      metric: anomalies.length
    });
  }

  if (overBudget.length > 0) {
    recommendations.push({
      title: "Zejdź z wydatkami w kategoriach po limicie",
      rationale: `Przekroczone budżety w tym miesiącu: ${overBudget.map((budget) => `${budget.category} ${amount(budget.spent, context.baseCurrency)}/${amount(budget.budget, context.baseCurrency)}`).join("; ")}.`,
      priority: "high"
    });
  }

  if (monthlyInvestmentCapacity != null && netCashflow < monthlyInvestmentCapacity) {
    recommendations.push({
      title: "Dopasuj plan inwestowania do faktycznego cashflow",
      rationale: `Deklarowana zdolność inwestycyjna to ${monthlyInvestmentCapacity.toLocaleString("pl-PL")} ${context.baseCurrency}, a bieżący cashflow wynosi ${netCashflow.toLocaleString("pl-PL")} ${context.baseCurrency}.`,
      priority: "medium"
    });
  }

  const moverSentence = topIncrease
    ? ` Największy ruch miesiąc do miesiąca: ${topIncrease.category} ${topIncrease.delta > 0 ? "+" : ""}${amount(topIncrease.delta, context.baseCurrency)}.`
    : "";
  const paceSentence = ` Prognozowane tempo bieżącego miesiąca: ${amount(pace.projected, context.baseCurrency)} (projekcja z ${pace.dayOfMonth}/${pace.daysInMonth} dni).`;

  return {
    summary: `W bieżącym miesiącu wpływy wynoszą ${monthlyInflow.toLocaleString("pl-PL")} ${context.baseCurrency}, wydatki ${monthlyOutflow.toLocaleString("pl-PL")} ${context.baseCurrency}, a cashflow ${netCashflow.toLocaleString("pl-PL")} ${context.baseCurrency}.${moverSentence}${paceSentence}`,
    opportunities,
    recommendations,
    riskFlags: flags,
    unknowns: context.transactions.length === 0 ? ["Brak zaimportowanych transakcji mBank."] : []
  };
}
