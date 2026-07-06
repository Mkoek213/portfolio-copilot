import type { PrismaClient, StrategySettings, UserFinancialProfile } from "@prisma/client";
import type { RiskTolerance, StrategyMemory } from "./types";

export const LOCAL_RESOURCE_ID = "local-user";

const defaultTargetAllocation = {
  CASH: 15,
  ETF_STOCK: 50,
  STOCK: 10,
  BOND: 10,
  CRYPTO: 10,
  COMMODITY: 5,
  OTHER: 0
};

export const defaultStrategy: StrategyMemory = {
  resourceId: LOCAL_RESOURCE_ID,
  profile: "balanced-growth",
  age: null,
  lifeStage: "student",
  baseCurrency: "PLN",
  investmentHorizonYears: 15,
  riskTolerance: "medium",
  monthlyIncome: null,
  monthlyFixedCosts: null,
  monthlyInvestmentCapacity: null,
  goals: ["Zbudować długoterminowy kapitał bez automatycznych zleceń."],
  constraints: ["Aplikacja jest read-only i nie wykonuje operacji finansowych."],
  preferredReportLength: "short",
  preferredReportLanguage: "pl",
  targetAllocation: defaultTargetAllocation,
  maxSinglePositionPercent: 35,
  maxCryptoPercent: 20,
  minCashPercent: 8,
  privacyRules: {
    anonymizePersonalData: false,
    sendOnlyAggregatesToLlm: false
  }
};

export function strategySettingsCreateInput(strategy: StrategyMemory = defaultStrategy) {
  return {
    resourceId: strategy.resourceId,
    profile: strategy.profile,
    baseCurrency: strategy.baseCurrency,
    targetAllocation: strategy.targetAllocation,
    maxSinglePositionPercent: strategy.maxSinglePositionPercent,
    maxCryptoPercent: strategy.maxCryptoPercent,
    minCashPercent: strategy.minCashPercent,
    preferredReportLanguage: strategy.preferredReportLanguage,
    privacyRules: strategy.privacyRules
  };
}

export function financialProfileCreateInput(strategy: StrategyMemory = defaultStrategy) {
  return {
    resourceId: strategy.resourceId,
    age: strategy.age,
    lifeStage: strategy.lifeStage,
    baseCurrency: strategy.baseCurrency,
    investmentHorizonYears: strategy.investmentHorizonYears,
    riskTolerance: strategy.riskTolerance.toUpperCase() as Uppercase<RiskTolerance>,
    monthlyIncome: strategy.monthlyIncome,
    monthlyFixedCosts: strategy.monthlyFixedCosts,
    monthlyInvestmentCapacity: strategy.monthlyInvestmentCapacity,
    goals: strategy.goals,
    constraints: strategy.constraints,
    preferredReportLength: strategy.preferredReportLength,
    preferredReportLanguage: strategy.preferredReportLanguage
  };
}

export async function getOrCreateStrategySettings(
  db: PrismaClient,
  resourceId = LOCAL_RESOURCE_ID
): Promise<StrategySettings> {
  const existing = await db.strategySettings.findUnique({
    where: { resourceId }
  });

  if (existing) {
    return existing;
  }

  return db.strategySettings.create({
    data: strategySettingsCreateInput({
      ...defaultStrategy,
      resourceId
    })
  });
}

export async function getOrCreateUserFinancialProfile(
  db: PrismaClient,
  resourceId = LOCAL_RESOURCE_ID
): Promise<UserFinancialProfile> {
  const existing = await db.userFinancialProfile.findUnique({
    where: { resourceId }
  });

  if (existing) {
    return existing;
  }

  return db.userFinancialProfile.create({
    data: financialProfileCreateInput({
      ...defaultStrategy,
      resourceId
    })
  });
}

function stringArray(value: unknown, fallback: string[]) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : fallback;
}

function reportLength(value: string) {
  return ["short", "medium", "long"].includes(value) ? value : defaultStrategy.preferredReportLength;
}

function riskTolerance(value: string): RiskTolerance {
  const normalized = value.toLowerCase();
  return ["low", "medium", "high", "very_high"].includes(normalized) ? (normalized as RiskTolerance) : defaultStrategy.riskTolerance;
}

export function strategyFromSettings(
  settings: StrategySettings | null | undefined,
  profile: UserFinancialProfile | null | undefined = null
): StrategyMemory {
  const targetAllocation = settings?.targetAllocation as StrategyMemory["targetAllocation"] | undefined;
  const privacyRules = settings?.privacyRules as StrategyMemory["privacyRules"] | undefined;

  return {
    resourceId: profile?.resourceId ?? settings?.resourceId ?? defaultStrategy.resourceId,
    profile: settings?.profile ?? defaultStrategy.profile,
    age: profile?.age ?? defaultStrategy.age,
    lifeStage: profile?.lifeStage ?? defaultStrategy.lifeStage,
    baseCurrency: profile?.baseCurrency ?? settings?.baseCurrency ?? defaultStrategy.baseCurrency,
    investmentHorizonYears: profile?.investmentHorizonYears ?? defaultStrategy.investmentHorizonYears,
    riskTolerance: profile ? riskTolerance(profile.riskTolerance) : defaultStrategy.riskTolerance,
    monthlyIncome: profile?.monthlyIncome == null ? defaultStrategy.monthlyIncome : Number(profile.monthlyIncome),
    monthlyFixedCosts: profile?.monthlyFixedCosts == null ? defaultStrategy.monthlyFixedCosts : Number(profile.monthlyFixedCosts),
    monthlyInvestmentCapacity:
      profile?.monthlyInvestmentCapacity == null ? defaultStrategy.monthlyInvestmentCapacity : Number(profile.monthlyInvestmentCapacity),
    goals: stringArray(profile?.goals, defaultStrategy.goals),
    constraints: stringArray(profile?.constraints, defaultStrategy.constraints),
    preferredReportLength: profile ? reportLength(profile.preferredReportLength) : defaultStrategy.preferredReportLength,
    preferredReportLanguage: profile?.preferredReportLanguage ?? settings?.preferredReportLanguage ?? defaultStrategy.preferredReportLanguage,
    targetAllocation: {
      ...defaultStrategy.targetAllocation,
      ...targetAllocation
    },
    maxSinglePositionPercent: settings?.maxSinglePositionPercent == null ? defaultStrategy.maxSinglePositionPercent : Number(settings.maxSinglePositionPercent),
    maxCryptoPercent: settings?.maxCryptoPercent == null ? defaultStrategy.maxCryptoPercent : Number(settings.maxCryptoPercent),
    minCashPercent: settings?.minCashPercent == null ? defaultStrategy.minCashPercent : Number(settings.minCashPercent),
    privacyRules: {
      ...defaultStrategy.privacyRules,
      ...privacyRules
    }
  };
}
