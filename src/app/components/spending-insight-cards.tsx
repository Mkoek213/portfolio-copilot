import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney, formatMoneyExact, formatPercent } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { expenseCategoryLabel } from "@/domain/portfolio/categories";
import { ANOMALY_RULE_LABELS, type BudgetStatusLevel, type SpendingInsights } from "@/domain/portfolio/spending-insights";
import { SectionCard, StatusChip, type ChipTone } from "./ui";

/**
 * Plan-20 Overview insight cards. Server Components over the already-computed,
 * already-plain `SpendingInsights` payload: no Prisma types, no client JS, and
 * no LLM call on render. The narrative for these numbers comes from the latest
 * report; these cards render with or without it.
 */

const BUDGET_TONE: Record<BudgetStatusLevel, ChipTone> = {
  on_track: "good",
  near: "warn",
  over: "crit"
};

const BUDGET_BAR: Record<BudgetStatusLevel, string> = {
  on_track: "bg-good",
  near: "bg-warn",
  over: "bg-crit"
};

const BUDGET_LABEL: Record<BudgetStatusLevel, string> = {
  on_track: "on track",
  near: "near limit",
  over: "over budget"
};

/** `YYYY-MM-DD` as a local calendar date, so the formatter never shifts a day. */
function localDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function signedMoney(value: number) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatMoney(Math.abs(value))}`;
}

export function CategoryDeltasCard({ insights }: { insights: SpendingInsights }) {
  const { deltas, pace, months } = insights;

  return (
    <SectionCard title="Month-over-month spending" sub={`${months.lastCompleted} vs ${months.priorCompleted} · completed months only`}>
      <div className="grid">
        {deltas.map((delta) => (
          <article className="grid gap-1 border-b border-border py-[11px] first:pt-0 last:border-0 last:pb-0" key={delta.category}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <strong className="text-[0.86rem] font-semibold">{expenseCategoryLabel(delta.category)}</strong>
              <span className={cn("text-[0.86rem] font-[650] tabular-nums", delta.delta > 0 ? "text-warn" : "text-good")}>
                {signedMoney(delta.delta)}
                <span className="ml-1.5 text-[0.76rem] font-medium text-muted-foreground">
                  {delta.deltaPercent === null ? "nowe" : formatPercent(delta.deltaPercent)}
                </span>
              </span>
            </div>
            <span className="text-[0.78rem] text-muted-foreground tabular-nums">
              {formatMoney(delta.current)} vs {formatMoney(delta.previous)}
            </span>
          </article>
        ))}
        {deltas.length === 0 ? (
          <p className="text-[0.86rem] text-muted-foreground">No completed months to compare yet.</p>
        ) : null}
      </div>

      {/* The in-progress month never enters the deltas above; it is shown here as
          an explicitly labeled projection so a half-finished month is not read
          as a real drop. */}
      <div className="mt-3.5 grid gap-1 rounded-md border border-border bg-secondary px-3 py-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[0.72rem] font-medium text-muted-foreground">
            prognozowane tempo · {pace.month} (dzień {pace.dayOfMonth} z {pace.daysInMonth})
          </span>
          <span
            className={cn(
              "text-[0.86rem] font-[650] tabular-nums",
              pace.previousTotal === 0 ? "text-foreground" : pace.delta > 0 ? "text-warn" : "text-good"
            )}
          >
            {formatMoney(pace.projected)}
          </span>
        </div>
        <span className="text-[0.78rem] text-muted-foreground tabular-nums">
          {formatMoney(pace.monthToDate)} so far · {formatMoney(pace.previousTotal)} in {pace.previousMonth}
        </span>
      </div>
    </SectionCard>
  );
}

export function SpendingAnomaliesCard({ insights }: { insights: SpendingInsights }) {
  const { anomalies, anomaliesStarved } = insights;

  return (
    <SectionCard title="Unusual transactions" sub={`${anomalies.length} flagged · current and last completed month`}>
      <div className="grid">
        {anomalies.map((anomaly) => (
          <article className="grid gap-1.5 border-b border-border py-[11px] first:pt-0 last:border-0 last:pb-0" key={anomaly.transactionId}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <strong className="text-[0.86rem] font-semibold [overflow-wrap:anywhere]">{anomaly.merchant ?? expenseCategoryLabel(anomaly.category)}</strong>
              <span className="text-[0.86rem] font-[650] tabular-nums text-warn">{formatMoneyExact(anomaly.amount)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[0.78rem] text-muted-foreground">{formatDate(localDate(anomaly.date))}</span>
              <Badge variant="muted">{expenseCategoryLabel(anomaly.category)}</Badge>
              {anomaly.rules.map((rule) => (
                <Badge variant="warn" key={rule}>
                  {ANOMALY_RULE_LABELS[rule]}
                </Badge>
              ))}
            </div>
          </article>
        ))}
        {anomalies.length === 0 ? (
          <p className="text-[0.86rem] text-muted-foreground">
            {anomaliesStarved ? "Za mało danych, aby wykryć anomalie." : "Nothing unusual in the last two months."}
          </p>
        ) : null}
      </div>
    </SectionCard>
  );
}

export function BudgetStatusCard({ insights }: { insights: SpendingInsights }) {
  const { budgets, months } = insights;

  return (
    <SectionCard title="Category budgets" sub={`${budgets.length} tracked · ${months.current}`}>
      <div className="grid gap-3.5">
        {budgets.map((budget) => (
          <article className="grid gap-1.5" key={budget.category}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-[0.86rem] font-semibold">{expenseCategoryLabel(budget.category)}</strong>
              <StatusChip tone={BUDGET_TONE[budget.status]} label={BUDGET_LABEL[budget.status]} />
            </div>
            <span
              className="block h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={`${expenseCategoryLabel(budget.category)}: ${formatPercent(Math.round(budget.ratio * 1000) / 10)} of the monthly budget used`}
            >
              <i className={cn("block h-full rounded-full", BUDGET_BAR[budget.status])} style={{ width: `${Math.min(budget.ratio * 100, 100)}%` }} />
            </span>
            <span className="text-[0.78rem] text-muted-foreground tabular-nums">
              {formatMoney(budget.spent)} / {formatMoney(budget.budget)}
            </span>
          </article>
        ))}
        {budgets.length === 0 ? (
          <div className="grid gap-2">
            <p className="text-[0.86rem] text-muted-foreground">No category budgets yet. Set a monthly cap to track spending against it.</p>
            <Link
              className="inline-flex w-fit items-center gap-1.5 rounded-sm text-[0.85rem] font-semibold text-brand-strong outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              href="/?tab=strategy"
            >
              Set budgets in Strategy <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
