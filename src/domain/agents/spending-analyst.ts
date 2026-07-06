import type { AnalysisResult, Opportunity, PortfolioContext, Recommendation, RiskFlag } from "@/domain/portfolio/types";

const NON_ESSENTIAL_CATEGORIES = new Set(["subscriptions", "entertainment", "shopping"]);

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

  if (monthlyInvestmentCapacity != null && netCashflow < monthlyInvestmentCapacity) {
    recommendations.push({
      title: "Dopasuj plan inwestowania do faktycznego cashflow",
      rationale: `Deklarowana zdolność inwestycyjna to ${monthlyInvestmentCapacity.toLocaleString("pl-PL")} ${context.baseCurrency}, a bieżący cashflow wynosi ${netCashflow.toLocaleString("pl-PL")} ${context.baseCurrency}.`,
      priority: "medium"
    });
  }

  return {
    summary: `W bieżącym miesiącu wpływy wynoszą ${monthlyInflow.toLocaleString("pl-PL")} ${context.baseCurrency}, wydatki ${monthlyOutflow.toLocaleString("pl-PL")} ${context.baseCurrency}, a cashflow ${netCashflow.toLocaleString("pl-PL")} ${context.baseCurrency}.`,
    opportunities,
    recommendations,
    riskFlags: flags,
    unknowns: context.transactions.length === 0 ? ["Brak zaimportowanych transakcji mBank."] : []
  };
}
