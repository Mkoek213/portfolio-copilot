import type { AnalysisResult, Opportunity, PortfolioContext, Recommendation } from "@/domain/portfolio/types";

export function analysePortfolio(context: PortfolioContext): Pick<AnalysisResult, "summary" | "opportunities" | "recommendations" | "rebalancingPlan" | "unknowns"> {
  const largestPosition = context.allocationByPosition[0];
  const cryptoAllocation = context.allocationByClass.find((item) => item.key === "CRYPTO")?.percent ?? 0;
  const cashAllocation = context.allocationByClass.find((item) => item.key === "CASH")?.percent ?? 0;
  const etfAllocation = context.allocationByClass.find((item) => item.key === "ETF_STOCK")?.percent ?? 0;

  const opportunities: Opportunity[] = [];
  const recommendations: Recommendation[] = [];
  const rebalancingPlan: Recommendation[] = [];

  if (etfAllocation < context.strategy.targetAllocation.ETF_STOCK - 5) {
    opportunities.push({
      title: "ETF-y akcyjne są poniżej docelowej alokacji",
      rationale: `Aktualna alokacja ETF_STOCK wynosi ${etfAllocation}%, a strategia celuje w ${context.strategy.targetAllocation.ETF_STOCK}%.`,
      confidence: "medium"
    });
  }

  if (cashAllocation > context.strategy.targetAllocation.CASH + 8) {
    opportunities.push({
      title: "Nadwyżka gotówki może zostać zaplanowana w rebalancingu",
      rationale: `Gotówka to ${cashAllocation}% portfela przy celu ${context.strategy.targetAllocation.CASH}%.`,
      confidence: "medium"
    });
  }

  if (largestPosition && largestPosition.percent > context.strategy.maxSinglePositionPercent) {
    recommendations.push({
      title: "Zmniejsz koncentrację największej pozycji",
      rationale: `${largestPosition.label} odpowiada za ${largestPosition.percent}% portfela, powyżej limitu ${context.strategy.maxSinglePositionPercent}%.`,
      priority: "high"
    });
  }

  if (cryptoAllocation > context.strategy.maxCryptoPercent) {
    recommendations.push({
      title: "Ogranicz ekspozycję na krypto",
      rationale: `Krypto stanowi ${cryptoAllocation}% portfela, a limit strategii to ${context.strategy.maxCryptoPercent}%.`,
      priority: "high"
    });
  }

  if (cashAllocation < context.strategy.minCashPercent) {
    recommendations.push({
      title: "Odbuduj bufor gotówkowy",
      rationale: `Gotówka wynosi ${cashAllocation}% portfela, poniżej minimum ${context.strategy.minCashPercent}%.`,
      priority: "medium"
    });
  }

  rebalancingPlan.push({
    title: "Użyj nowych wpłat do korekty odchyleń",
    rationale: "Pierwszy MVP nie proponuje transakcji. Plan wskazuje tylko, które klasy aktywów są odchylone od strategii.",
    priority: "medium"
  });

  return {
    summary: `Portfel sample ma wartość ${context.totalValue.toLocaleString("pl-PL")} ${context.baseCurrency}. Największy nacisk analizy: koncentracja, ekspozycja krypto i zgodność z docelową alokacją.`,
    opportunities,
    recommendations,
    rebalancingPlan,
    unknowns: context.missingData
  };
}
