import type { PortfolioContext, RiskFlag } from "@/domain/portfolio/types";

export function reviewRisks(context: PortfolioContext): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const largestPosition = context.allocationByPosition[0];
  const cryptoAllocation = context.allocationByClass.find((item) => item.key === "CRYPTO")?.percent ?? 0;
  const cashAllocation = context.allocationByClass.find((item) => item.key === "CASH")?.percent ?? 0;
  const usdExposure = context.allocationByCurrency.find((item) => item.key === "USD")?.percent ?? 0;

  if (largestPosition && largestPosition.percent > context.strategy.maxSinglePositionPercent) {
    flags.push({
      level: "critical",
      topic: "single-position-concentration",
      message: `${largestPosition.label} przekracza limit koncentracji pojedynczej pozycji.`,
      metric: largestPosition.percent
    });
  }

  if (cryptoAllocation > context.strategy.maxCryptoPercent) {
    flags.push({
      level: "warning",
      topic: "crypto-exposure",
      message: "Ekspozycja na krypto przekracza limit zapisany w working memory strategii.",
      metric: cryptoAllocation
    });
  }

  if (cashAllocation < context.strategy.minCashPercent) {
    flags.push({
      level: "warning",
      topic: "cash-buffer",
      message: "Bufor gotówkowy jest niższy niż minimalny poziom strategii.",
      metric: cashAllocation
    });
  }

  if (usdExposure > 45) {
    flags.push({
      level: "info",
      topic: "currency-exposure",
      message: "Portfel ma istotną ekspozycję na USD. Wymaga to świadomej akceptacji ryzyka walutowego.",
      metric: usdExposure
    });
  }

  for (const missingData of context.missingData) {
    flags.push({
      level: "info",
      topic: "missing-data",
      message: missingData
    });
  }

  return flags;
}
