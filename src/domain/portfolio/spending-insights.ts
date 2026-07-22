import { roundMoney, roundPercent } from "./calculations";

/**
 * Deterministic spending insights (plan 20): month-over-month category deltas,
 * the current-month pace, labeled anomaly flags and budget status.
 *
 * Framework-free and pure: every function takes plain numbers/strings (no Prisma
 * `Decimal`/`Date` crosses in) and returns plain data, so the same computation
 * feeds the Overview cards and the analysis-run narrative. The LLM only narrates
 * these numbers, it never produces them.
 *
 * Thresholds live here as named constants so a future tune is a one-line edit.
 */

/** Trailing window the loader must supply, in months, counting back from the current month. */
export const TRAILING_WINDOW_MONTHS = 6;

/** Top movers kept in the month-over-month delta list (increases and decreases). */
export const MAX_CATEGORY_MOVERS = 6;

/** Cap on flagged transactions handed to the Overview anomalies card. */
export const MAX_ANOMALIES = 8;

/** Amount-outlier rule: `median + MULTIPLIER * MAD` over the category's trailing samples. */
export const AMOUNT_OUTLIER_MAD_MULTIPLIER = 3.5;

/** Amount-outlier rule: prior samples required in the category before it may fire. */
export const AMOUNT_OUTLIER_MIN_SAMPLES = 8;

/**
 * Amount-outlier fallback for a category whose trailing samples are all but
 * identical (MAD of 0): without it every amount a cent above the median would
 * trip, with it only a genuine multiple of the usual amount does.
 */
export const AMOUNT_OUTLIER_FLAT_MEDIAN_MULTIPLIER = 3;

/** Category-spike rule: a completed month above this multiple of its trailing average. */
export const CATEGORY_SPIKE_MULTIPLIER = 1.5;

/** Category-spike rule: months of prior history required in the category. */
export const CATEGORY_SPIKE_MIN_MONTHS = 3;

/** Category-spike rule: absolute PLN floor, so tiny categories never trip it. */
export const CATEGORY_SPIKE_MIN_TOTAL = 400;

/** New-merchant rule: PLN floor, cutting one-off small-purchase noise. */
export const NEW_MERCHANT_MIN_AMOUNT = 200;

/**
 * New-merchant cold-start guard: with barely any merchant history every merchant
 * is "new", which is noise rather than a signal, so the rule stays silent.
 */
export const NEW_MERCHANT_MIN_KNOWN_KEYS = 5;

/** Budget status boundary between `on_track` and `near` (share of the monthly cap). */
export const BUDGET_NEAR_RATIO = 0.8;

export type InsightMonthlyTotal = {
  /** `YYYY-MM`. */
  month: string;
  category: string;
  /** Positive PLN outflow total for the category in that month. */
  total: number;
};

export type InsightTransaction = {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** Positive PLN outflow amount. */
  amount: number;
  category: string;
  merchant: string | null;
  /** `normalizeMerchantKey(merchant)`, or `null` when the merchant cannot be keyed. */
  merchantKey: string | null;
};

export type CategoryBudgetInput = {
  category: string;
  amount: number;
};

export type SpendingInsightsInput = {
  /** The local calendar day the render or run happens on, `YYYY-MM-DD`. */
  today: string;
  /** Per-category outflow totals per month across the trailing window, current month included. */
  monthlyTotals: InsightMonthlyTotal[];
  /** Outflow transactions across the same trailing window. */
  transactions: InsightTransaction[];
  /** Merchant keys already seen strictly before the trailing window. */
  knownMerchantKeys: string[];
  budgets: CategoryBudgetInput[];
};

export type CategoryDelta = {
  category: string;
  current: number;
  previous: number;
  delta: number;
  /** `null` when `previous` is 0 - new spending, not a divide-by-zero percentage. */
  deltaPercent: number | null;
};

export type SpendingPace = {
  /** `YYYY-MM` of the in-progress month. */
  month: string;
  monthToDate: number;
  dayOfMonth: number;
  daysInMonth: number;
  /** `monthToDate / dayOfMonth * daysInMonth`, always labeled as a projection in the UI. */
  projected: number;
  previousMonth: string;
  previousTotal: number;
  delta: number;
  deltaPercent: number | null;
};

export type AnomalyRuleId = "amount_outlier" | "category_spike" | "new_merchant";

export type AnomalyFlag = {
  transactionId: string;
  date: string;
  month: string;
  amount: number;
  category: string;
  merchant: string | null;
  /** Every rule that fired for this transaction, in a stable order. */
  rules: AnomalyRuleId[];
};

export type AnomalyDetection = {
  flags: AnomalyFlag[];
  /** Rules that had enough history to be evaluated at all; empty means cold start. */
  evaluatedRules: AnomalyRuleId[];
};

export type BudgetStatusLevel = "on_track" | "near" | "over";

export type BudgetStatus = {
  category: string;
  spent: number;
  budget: number;
  /** `spent / budget`, rounded to one decimal of a percent. */
  ratio: number;
  status: BudgetStatusLevel;
};

export type SpendingInsights = {
  months: {
    current: string;
    lastCompleted: string;
    priorCompleted: string;
  };
  deltas: CategoryDelta[];
  pace: SpendingPace;
  anomalies: AnomalyFlag[];
  /** True when every anomaly rule was starved of history, so the card shows its cold-start note. */
  anomaliesStarved: boolean;
  budgets: BudgetStatus[];
};

const RULE_ORDER: AnomalyRuleId[] = ["amount_outlier", "category_spike", "new_merchant"];

/** Chip labels for the rule that fired, in the data language the rest of the domain uses. */
export const ANOMALY_RULE_LABELS: Record<AnomalyRuleId, string> = {
  amount_outlier: "kwota odstająca",
  category_spike: "skok kategorii",
  new_merchant: "nowy kontrahent"
};

export function monthOf(date: string) {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, offset: number) {
  const [year, index] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, index - 1 + offset, 1));

  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function daysInMonth(month: string) {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index, 0)).getUTCDate();
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function medianAbsoluteDeviation(values: number[], center: number) {
  return median(values.map((value) => Math.abs(value - center)));
}

function totalsByCategory(monthlyTotals: InsightMonthlyTotal[], month: string) {
  const totals = new Map<string, number>();

  for (const entry of monthlyTotals) {
    if (entry.month === month) {
      totals.set(entry.category, (totals.get(entry.category) ?? 0) + entry.total);
    }
  }

  return totals;
}

function monthTotal(monthlyTotals: InsightMonthlyTotal[], month: string) {
  return monthlyTotals.reduce((sum, entry) => (entry.month === month ? sum + entry.total : sum), 0);
}

/**
 * Month-over-month category movers, comparing the two most recent completed
 * months. The in-progress month is never an input here: a partial month against
 * a full one reads as a fake drop, so it is surfaced by `computeSpendingPace`
 * instead.
 */
export function computeCategoryDeltas(
  monthlyTotals: InsightMonthlyTotal[],
  options: { lastCompletedMonth: string; priorCompletedMonth: string; limit?: number }
): CategoryDelta[] {
  const current = totalsByCategory(monthlyTotals, options.lastCompletedMonth);
  const previous = totalsByCategory(monthlyTotals, options.priorCompletedMonth);
  const categories = new Set([...current.keys(), ...previous.keys()]);
  const deltas: CategoryDelta[] = [];

  for (const category of categories) {
    const currentTotal = roundMoney(current.get(category) ?? 0);
    const previousTotal = roundMoney(previous.get(category) ?? 0);
    const delta = roundMoney(currentTotal - previousTotal);

    if (currentTotal === 0 && previousTotal === 0) {
      continue;
    }

    deltas.push({
      category,
      current: currentTotal,
      previous: previousTotal,
      delta,
      deltaPercent: previousTotal === 0 ? null : roundPercent((delta / previousTotal) * 100)
    });
  }

  return deltas
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.category.localeCompare(b.category))
    .slice(0, options.limit ?? MAX_CATEGORY_MOVERS);
}

/**
 * The in-progress month's projected pace against the last completed month. Kept
 * separate from the deltas and always rendered with an explicit projection
 * label, so a half-finished month is never mistaken for a real drop.
 */
export function computeSpendingPace(
  monthlyTotals: InsightMonthlyTotal[],
  options: { today: string; currentMonth: string; lastCompletedMonth: string }
): SpendingPace {
  const dayOfMonth = Number(options.today.slice(8, 10));
  const totalDays = daysInMonth(options.currentMonth);
  const monthToDate = roundMoney(monthTotal(monthlyTotals, options.currentMonth));
  const previousTotal = roundMoney(monthTotal(monthlyTotals, options.lastCompletedMonth));
  const projected = dayOfMonth > 0 ? roundMoney((monthToDate / dayOfMonth) * totalDays) : monthToDate;
  const delta = roundMoney(projected - previousTotal);

  return {
    month: options.currentMonth,
    monthToDate,
    dayOfMonth,
    daysInMonth: totalDays,
    projected,
    previousMonth: options.lastCompletedMonth,
    previousTotal,
    delta,
    deltaPercent: previousTotal === 0 ? null : roundPercent((delta / previousTotal) * 100)
  };
}

/**
 * Flags unusual transactions in the current and last completed month with the
 * rule(s) that fired. Each rule self-suppresses below its own minimum, so thin
 * history produces no flags rather than false ones; `evaluatedRules` reports
 * which rules had enough data to run at all.
 */
export function detectSpendingAnomalies(
  input: {
    transactions: InsightTransaction[];
    monthlyTotals: InsightMonthlyTotal[];
    knownMerchantKeys: string[];
    currentMonth: string;
    lastCompletedMonth: string;
    limit?: number;
  }
): AnomalyDetection {
  const scopeMonths = new Set([input.currentMonth, input.lastCompletedMonth]);
  const ordered = [...input.transactions].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const scoped = ordered.filter((transaction) => scopeMonths.has(monthOf(transaction.date)));
  const rules = new Map<string, Set<AnomalyRuleId>>();
  const evaluated = new Set<AnomalyRuleId>();

  const fire = (transactionId: string, rule: AnomalyRuleId) => {
    const current = rules.get(transactionId) ?? new Set<AnomalyRuleId>();
    current.add(rule);
    rules.set(transactionId, current);
  };

  // Rule 1 - amount outlier within its category, against the category's own
  // trailing samples from strictly earlier months (robust median + MAD).
  for (const transaction of scoped) {
    const transactionMonth = monthOf(transaction.date);
    const samples = ordered
      .filter((candidate) => candidate.category === transaction.category && monthOf(candidate.date) < transactionMonth)
      .map((candidate) => candidate.amount);

    if (samples.length < AMOUNT_OUTLIER_MIN_SAMPLES) {
      continue;
    }

    evaluated.add("amount_outlier");

    const center = median(samples);
    const deviation = medianAbsoluteDeviation(samples, center);
    const threshold =
      deviation > 0 ? center + AMOUNT_OUTLIER_MAD_MULTIPLIER * deviation : center * AMOUNT_OUTLIER_FLAT_MEDIAN_MULTIPLIER;

    if (transaction.amount > threshold) {
      fire(transaction.id, "amount_outlier");
    }
  }

  // Rule 2 - category month-spike on the last completed month. It is a
  // category-level signal, so it lands on that month's largest transaction in
  // the category, which is what the card can actually show.
  const spikeTotals = totalsByCategory(input.monthlyTotals, input.lastCompletedMonth);
  const priorMonths = Array.from({ length: CATEGORY_SPIKE_MIN_MONTHS }, (_, index) =>
    shiftMonth(input.lastCompletedMonth, -(index + 1))
  );

  for (const [category, total] of spikeTotals) {
    const history = priorMonths
      .map((month) => input.monthlyTotals.find((entry) => entry.month === month && entry.category === category))
      .filter((entry): entry is InsightMonthlyTotal => entry !== undefined);

    if (history.length < CATEGORY_SPIKE_MIN_MONTHS) {
      continue;
    }

    evaluated.add("category_spike");

    const average = history.reduce((sum, entry) => sum + entry.total, 0) / history.length;

    if (total <= average * CATEGORY_SPIKE_MULTIPLIER || total < CATEGORY_SPIKE_MIN_TOTAL) {
      continue;
    }

    const largest = scoped
      .filter((transaction) => transaction.category === category && monthOf(transaction.date) === input.lastCompletedMonth)
      .sort((a, b) => b.amount - a.amount)[0];

    if (largest) {
      fire(largest.id, "category_spike");
    }
  }

  // Rule 3 - first transaction of a merchant never seen before, above the floor.
  const seen = new Set(input.knownMerchantKeys);

  for (const transaction of ordered) {
    if (scopeMonths.has(monthOf(transaction.date))) {
      break;
    }

    if (transaction.merchantKey) {
      seen.add(transaction.merchantKey);
    }
  }

  if (seen.size >= NEW_MERCHANT_MIN_KNOWN_KEYS) {
    evaluated.add("new_merchant");

    for (const transaction of scoped) {
      if (!transaction.merchantKey || seen.has(transaction.merchantKey)) {
        continue;
      }

      seen.add(transaction.merchantKey);

      if (transaction.amount >= NEW_MERCHANT_MIN_AMOUNT) {
        fire(transaction.id, "new_merchant");
      }
    }
  }

  const byId = new Map(scoped.map((transaction) => [transaction.id, transaction]));
  const flags: AnomalyFlag[] = [];

  for (const [transactionId, fired] of rules) {
    const transaction = byId.get(transactionId);

    if (!transaction) {
      continue;
    }

    flags.push({
      transactionId,
      date: transaction.date,
      month: monthOf(transaction.date),
      amount: roundMoney(transaction.amount),
      category: transaction.category,
      merchant: transaction.merchant,
      rules: RULE_ORDER.filter((rule) => fired.has(rule))
    });
  }

  return {
    flags: flags
      .sort((a, b) => b.rules.length - a.rules.length || b.amount - a.amount || a.transactionId.localeCompare(b.transactionId))
      .slice(0, input.limit ?? MAX_ANOMALIES),
    evaluatedRules: RULE_ORDER.filter((rule) => evaluated.has(rule))
  };
}

/**
 * Current-month status per budgeted category. Categories without a budget row
 * are untracked and never appear, so they can never flag.
 */
export function computeBudgetStatuses(
  budgets: CategoryBudgetInput[],
  monthlyTotals: InsightMonthlyTotal[],
  currentMonth: string
): BudgetStatus[] {
  const spending = totalsByCategory(monthlyTotals, currentMonth);

  return budgets
    .filter((budget) => budget.amount > 0)
    .map((budget) => {
      const spent = roundMoney(spending.get(budget.category) ?? 0);
      const ratio = spent / budget.amount;

      return {
        category: budget.category,
        spent,
        budget: roundMoney(budget.amount),
        ratio: roundPercent(ratio * 100) / 100,
        status: (ratio > 1 ? "over" : ratio >= BUDGET_NEAR_RATIO ? "near" : "on_track") as BudgetStatusLevel
      };
    })
    .sort((a, b) => b.ratio - a.ratio || a.category.localeCompare(b.category));
}

/** Composes every insight from one loaded input bundle - the single computation both callers share. */
export function buildSpendingInsights(input: SpendingInsightsInput): SpendingInsights {
  const currentMonth = monthOf(input.today);
  const lastCompletedMonth = shiftMonth(currentMonth, -1);
  const priorCompletedMonth = shiftMonth(currentMonth, -2);
  const anomalies = detectSpendingAnomalies({
    transactions: input.transactions,
    monthlyTotals: input.monthlyTotals,
    knownMerchantKeys: input.knownMerchantKeys,
    currentMonth,
    lastCompletedMonth
  });

  return {
    months: { current: currentMonth, lastCompleted: lastCompletedMonth, priorCompleted: priorCompletedMonth },
    deltas: computeCategoryDeltas(input.monthlyTotals, { lastCompletedMonth, priorCompletedMonth }),
    pace: computeSpendingPace(input.monthlyTotals, { today: input.today, currentMonth, lastCompletedMonth }),
    anomalies: anomalies.flags,
    anomaliesStarved: anomalies.evaluatedRules.length === 0,
    budgets: computeBudgetStatuses(input.budgets, input.monthlyTotals, currentMonth)
  };
}

/** The empty shape used when the database is unreachable or has no history at all. */
export function emptySpendingInsights(today: string): SpendingInsights {
  return buildSpendingInsights({ today, monthlyTotals: [], transactions: [], knownMerchantKeys: [], budgets: [] });
}
