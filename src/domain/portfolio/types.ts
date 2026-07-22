import type { SpendingInsights } from "./spending-insights";

export type AssetClass =
  | "CASH"
  | "ETF_STOCK"
  | "STOCK"
  | "BOND"
  | "CRYPTO"
  | "COMMODITY"
  | "OTHER";

export type TransactionDirection = "INFLOW" | "OUTFLOW";

export type ExpenseCategory =
  | "food"
  | "housing"
  | "transport"
  | "education"
  | "subscriptions"
  | "health"
  | "entertainment"
  | "investments"
  | "shopping"
  | "people_transfers"
  | "income"
  | "fees"
  | "other";

export type AllocationItem = {
  key: string;
  label: string;
  value: number;
  percent: number;
};

export type PositionSnapshot = {
  accountName: string;
  provider: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  currency: string;
  sector: string | null;
  quantity: number;
  marketPrice: number;
  marketValueBase: number;
  weight: number;
};

export type TransactionSnapshot = {
  id: string;
  operationDate: Date;
  amount: number;
  currency: string;
  direction: TransactionDirection;
  description: string;
  merchant: string | null;
  category: ExpenseCategory | string;
  accountLabel: string | null;
};

export type SpendingSummary = {
  currentMonth: string;
  monthlyInflow: number;
  monthlyOutflow: number;
  netCashflow: number;
  topCategories: AllocationItem[];
  recentTransactionCount: number;
};

export type ImportBatchSummary = {
  id: string;
  status: string;
  subject: string | null;
  operationDate: Date | null;
  transactionCount: number;
  errorMessage: string | null;
  createdAt: Date;
};

export type MemorySummary = {
  observations: Array<{
    id: string;
    priority: string;
    topic: string;
    content: string;
    createdAt: Date;
  }>;
  reflections: Array<{
    id: string;
    summary: string;
    topics: unknown;
    createdAt: Date;
  }>;
};

export type ReportSummary = {
  id: string;
  title: string;
  summary: string;
  reportType: string;
  criticVerdict: string;
  reporterSource: string;
  reporterModel: string | null;
  createdAt: Date;
};

export type PortfolioContext = {
  asOf: Date;
  baseCurrency: string;
  totalValue: number;
  positions: PositionSnapshot[];
  transactions: TransactionSnapshot[];
  spendingSummary: SpendingSummary;
  // Deterministic month-over-month deltas, pace, anomaly flags and budget status
  // (plan 20). Computed in the domain, only narrated by the reporter.
  spendingInsights: SpendingInsights;
  imports: ImportBatchSummary[];
  reports: ReportSummary[];
  memory: MemorySummary;
  allocationByClass: AllocationItem[];
  allocationByCurrency: AllocationItem[];
  allocationByPosition: AllocationItem[];
  missingData: string[];
  dataSourcesUsed: string[];
  strategy: StrategyMemory;
};

export type RiskTolerance = "low" | "medium" | "high" | "very_high";

export type StrategyMemory = {
  resourceId: string;
  profile: string;
  age: number | null;
  lifeStage: string;
  baseCurrency: string;
  investmentHorizonYears: number;
  riskTolerance: RiskTolerance;
  monthlyIncome: number | null;
  monthlyFixedCosts: number | null;
  monthlyInvestmentCapacity: number | null;
  goals: string[];
  constraints: string[];
  preferredReportLength: "short" | "medium" | "long" | string;
  preferredReportLanguage: string;
  targetAllocation: Record<AssetClass, number>;
  maxSinglePositionPercent: number;
  maxCryptoPercent: number;
  minCashPercent: number;
  privacyRules: {
    anonymizePersonalData: boolean;
    sendOnlyAggregatesToLlm: boolean;
  };
};

export type RiskFlag = {
  level: "info" | "warning" | "critical";
  topic: string;
  message: string;
  metric?: number;
};

export type Recommendation = {
  title: string;
  rationale: string;
  priority: "low" | "medium" | "high";
};

export type Opportunity = {
  title: string;
  rationale: string;
  confidence: "low" | "medium" | "high";
};

export type AnalysisResult = {
  summary: string;
  riskFlags: RiskFlag[];
  recommendations: Recommendation[];
  opportunities: Opportunity[];
  rebalancingPlan: Recommendation[];
  unknowns: string[];
};
