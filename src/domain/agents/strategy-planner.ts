import type { AnalysisResult, PortfolioContext, Recommendation } from "@/domain/portfolio/types";

export type StrategyPlannerResult = {
  suggestions: Recommendation[];
};

export function planStrategyAdjustments(context: PortfolioContext, analysis: Pick<AnalysisResult, "riskFlags" | "recommendations">): StrategyPlannerResult {
  const suggestions: Recommendation[] = [];
  const riskCount = analysis.riskFlags.filter((flag) => flag.level !== "info").length;

  if (context.strategy.goals.length === 0) {
    suggestions.push({
      title: "Dopisz cele finansowe do profilu",
      rationale: "Raport może priorytetyzować ryzyka trafniej, gdy profil ma konkretne cele użytkownika.",
      priority: "medium"
    });
  }

  if (context.strategy.riskTolerance === "low" && context.strategy.maxCryptoPercent > 10) {
    suggestions.push({
      title: "Obniż limit krypto dla niskiej tolerancji ryzyka",
      rationale: `Profil ma tolerancję ryzyka low, ale limit krypto wynosi ${context.strategy.maxCryptoPercent}%.`,
      priority: "high"
    });
  }

  if (context.strategy.investmentHorizonYears < 3 && context.strategy.targetAllocation.ETF_STOCK > 40) {
    suggestions.push({
      title: "Sprawdź horyzont względem udziału akcji",
      rationale: "Krótki horyzont i wysoka docelowa alokacja akcyjna mogą wymagać świadomej akceptacji ryzyka.",
      priority: "medium"
    });
  }

  if (riskCount >= 3) {
    suggestions.push({
      title: "Dodaj ograniczenia operacyjne do profilu",
      rationale: "Kilka aktywnych ryzyk sugeruje, że warto zapisać twarde tolerancje i ograniczenia w profilu zamiast pamiętać je poza aplikacją.",
      priority: "medium"
    });
  }

  return { suggestions };
}
