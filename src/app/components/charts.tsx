"use client";

import { motion, useReducedMotion } from "motion/react";
import { formatMoney, formatMoneyExact, formatMonthLabel, formatNumber, formatPercent } from "@/lib/format";
import { expenseCategoryLabel } from "@/domain/portfolio/categories";
import { cn } from "@/lib/utils";
import type { CategoryTotal, MonthlyCashflow } from "../dashboard-data";
import { ASSET_CLASS_SERIES, INFLOW_COLOR, OUTFLOW_COLOR, SINGLE_SERIES_COLOR, assetClassSeries } from "./chart-series";

/**
 * These charts stay hand-rolled and restyled with Tailwind. The color palette
 * lives in ./chart-series (a non-client module) so server components can read
 * it too. Every prop crossing into this client component is a plain
 * number/string (never a raw Prisma Decimal/Date) - keep it that way.
 */
const GROW_EASE = [0.16, 1, 0.3, 1] as const;

function niceCeiling(value: number) {
  if (value <= 0) {
    return 1;
  }

  const power = 10 ** Math.floor(Math.log10(value));
  const normalized = value / power;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return factor * power;
}

export function Sparkline({ points, ariaLabel }: { points: number[]; ariaLabel: string }) {
  if (points.length < 2) {
    return null;
  }

  const width = 120;
  const height = 34;
  const pad = 3;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = (width - pad * 2) / (points.length - 1);
  const coords = points.map((value, index) => ({
    x: pad + index * step,
    y: pad + (height - pad * 2) * (1 - (value - min) / range)
  }));
  const path = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];

  return (
    <svg className="absolute bottom-3 right-3.5 h-[30px] w-[104px]" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      <path d={path} fill="none" stroke="var(--muted-foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r="3.5" fill="var(--brand)" stroke="var(--card)" strokeWidth="2" />
    </svg>
  );
}

function LegendSwatch({ color }: { color: string }) {
  return <i className="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} aria-hidden="true" />;
}

export function CashflowChart({ months, currency = "PLN" }: { months: MonthlyCashflow[]; currency?: string }) {
  const reduceMotion = useReducedMotion();
  const peak = Math.max(...months.map((month) => Math.max(month.inflow, month.outflow)));

  if (peak <= 0) {
    return <p className="text-[0.86rem] text-muted-foreground">No imported transactions in the last 6 months yet.</p>;
  }

  const top = niceCeiling(peak);
  const ticks = [top, top / 2, 0];

  return (
    <figure className="m-0" aria-label={`Monthly inflow and outflow for the last ${months.length} months`}>
      <div className="mb-2.5 flex gap-4 text-[0.78rem] text-muted-foreground" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><LegendSwatch color={INFLOW_COLOR} /> Inflow</span>
        <span className="inline-flex items-center gap-1.5"><LegendSwatch color={OUTFLOW_COLOR} /> Outflow</span>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-2.5">
        <div className="flex h-[190px] translate-y-[-0.5em] flex-col items-end justify-between pt-[0.5em] text-[0.72rem] tabular-nums text-muted-foreground" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick}>{formatNumber(tick)}</span>
          ))}
        </div>
        <div>
          <div className="relative h-[190px]">
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              <span className="absolute inset-x-0 top-0 h-px bg-border" />
              <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
              <span className="absolute inset-x-0 bottom-0 h-px bg-[color:var(--input)]" />
            </div>
            <div className="absolute inset-0 flex">
              {months.map((month, index) => {
                const isFirst = index === 0;
                const isLast = index === months.length - 1;
                const tipPos = isFirst ? "left-0" : isLast ? "right-0" : "left-1/2 -translate-x-1/2";

                return (
                  <div
                    className="group relative flex flex-1 items-end justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    key={month.month}
                    tabIndex={0}
                    aria-label={`${formatMonthLabel(month.month)}: inflow ${formatMoney(month.inflow, currency)}, outflow ${formatMoney(month.outflow, currency)}`}
                  >
                    <div className="flex h-full items-end gap-0.5" aria-hidden="true">
                      <motion.span
                        className="w-[18px] origin-bottom rounded-t-[4px] transition-[filter] group-hover:brightness-110 group-focus-visible:brightness-110"
                        style={{ height: `${(month.inflow / top) * 100}%`, background: INFLOW_COLOR }}
                        initial={reduceMotion ? false : { scaleY: 0 }}
                        animate={{ scaleY: 1 }}
                        transition={{ duration: 0.55, ease: GROW_EASE, delay: index * 0.04 }}
                      />
                      <motion.span
                        className="w-[18px] origin-bottom rounded-t-[4px] transition-[filter] group-hover:brightness-110 group-focus-visible:brightness-110"
                        style={{ height: `${(month.outflow / top) * 100}%`, background: OUTFLOW_COLOR }}
                        initial={reduceMotion ? false : { scaleY: 0 }}
                        animate={{ scaleY: 1 }}
                        transition={{ duration: 0.55, ease: GROW_EASE, delay: index * 0.04 + 0.05 }}
                      />
                    </div>
                    <div
                      className={cn(
                        "pointer-events-none absolute bottom-[calc(100%+2px)] z-10 grid min-w-[158px] gap-1 rounded-md bg-[#22241f] px-[11px] py-[9px] text-[0.76rem] text-[#f4f4f0] opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100",
                        tipPos
                      )}
                      role="presentation"
                    >
                      <strong className="text-[0.72rem] font-semibold opacity-75">
                        {formatMonthLabel(month.month)} {month.month.slice(0, 4)}
                      </strong>
                      <span className="flex items-center gap-1.5">
                        <i className="inline-block h-[3px] w-2.5 shrink-0 rounded-[2px]" style={{ background: INFLOW_COLOR }} />
                        <em className="font-[650] not-italic tabular-nums">{formatMoney(month.inflow, currency)}</em> inflow
                      </span>
                      <span className="flex items-center gap-1.5">
                        <i className="inline-block h-[3px] w-2.5 shrink-0 rounded-[2px]" style={{ background: OUTFLOW_COLOR }} />
                        <em className="font-[650] not-italic tabular-nums">{formatMoney(month.outflow, currency)}</em> outflow
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-1.5 flex" aria-hidden="true">
            {months.map((month) => (
              <span key={month.month} className="flex-1 text-center text-[0.75rem] text-muted-foreground">
                {formatMonthLabel(month.month)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <details className="mt-3 [&[open]_summary]:mb-2">
        <summary className="w-fit cursor-pointer text-[0.78rem] text-muted-foreground hover:text-foreground">View data table</summary>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[0.86rem]">
            <thead>
              <tr>
                <th scope="col" className="border-b border-[color:var(--input)] px-2.5 py-[7px] text-left text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Month</th>
                <th scope="col" className="border-b border-[color:var(--input)] px-2.5 py-[7px] text-right text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Inflow</th>
                <th scope="col" className="border-b border-[color:var(--input)] px-2.5 py-[7px] text-right text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Outflow</th>
                <th scope="col" className="border-b border-[color:var(--input)] px-2.5 py-[7px] text-right text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Net</th>
              </tr>
            </thead>
            <tbody>
              {months.map((month) => (
                <tr key={month.month} className="[&>td]:border-b [&>td]:border-border last:[&>td]:border-0">
                  <td className="p-2.5 align-top">{formatMonthLabel(month.month)} {month.month.slice(0, 4)}</td>
                  <td className="p-2.5 text-right align-top tabular-nums">{formatMoneyExact(month.inflow, currency)}</td>
                  <td className="p-2.5 text-right align-top tabular-nums">{formatMoneyExact(month.outflow, currency)}</td>
                  <td className="p-2.5 text-right align-top tabular-nums">{formatMoneyExact(month.inflow - month.outflow, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

export function CategoryBars({ items, currency = "PLN" }: { items: CategoryTotal[]; currency?: string }) {
  const reduceMotion = useReducedMotion();

  if (items.length === 0) {
    return <p className="text-[0.86rem] text-muted-foreground">No imported spending for the current month.</p>;
  }

  const max = Math.max(...items.map((item) => item.value));

  return (
    <div className="grid gap-[11px]">
      {items.map((item) => {
        const label = item.category === "__rest__" ? "other categories" : expenseCategoryLabel(item.category);

        return (
          <div className="grid grid-cols-[128px_minmax(0,1fr)_auto_52px] items-center gap-3 max-[640px]:grid-cols-[92px_minmax(0,1fr)_auto]" key={item.category}>
            <span className="text-[0.84rem] text-muted-foreground [overflow-wrap:anywhere]">{label}</span>
            <div className="h-2 overflow-hidden rounded-[4px] bg-secondary" aria-hidden="true">
              <motion.span
                className="block h-full min-w-[2px] origin-left rounded-r-[4px]"
                style={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%`, background: SINGLE_SERIES_COLOR }}
                initial={reduceMotion ? false : { scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.55, ease: GROW_EASE }}
              />
            </div>
            <span className="whitespace-nowrap text-right text-[0.84rem] font-[650] tabular-nums">{formatMoney(item.value, currency)}</span>
            <span className="text-right text-[0.76rem] tabular-nums text-muted-foreground max-[640px]:hidden">{formatPercent(item.percent)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function AllocationStack({
  items,
  targets,
  totalValue,
  currency = "PLN"
}: {
  items: Array<{ key: string; label: string; value: number; percent: number }>;
  targets?: Record<string, number>;
  totalValue: number;
  currency?: string;
}) {
  const reduceMotion = useReducedMotion();

  if (items.length === 0 || totalValue <= 0) {
    return <p className="text-[0.86rem] text-muted-foreground">No portfolio positions yet. Seed the database or run an import.</p>;
  }

  // Segments render in the fixed series order so adjacency (and the CVD check
  // behind it) stays deterministic no matter how values shift.
  const ordered = ASSET_CLASS_SERIES
    .map((series) => items.find((item) => item.key === series.key))
    .filter((item): item is NonNullable<typeof item> => Boolean(item) && item!.value > 0);
  const unknown = items.filter((item) => item.value > 0 && !ASSET_CLASS_SERIES.some((series) => series.key === item.key));
  const segments = [...ordered, ...unknown];

  return (
    <div className="grid gap-3.5">
      <div className="flex h-[22px] gap-0.5 overflow-hidden rounded-md" role="img" aria-label={segments.map((segment) => `${assetClassSeries(segment.key).label} ${formatPercent(segment.percent)}`).join(", ")}>
        {segments.map((segment) => (
          <motion.span
            key={segment.key}
            className="block min-w-[3px] origin-left"
            style={{ width: `${segment.percent}%`, background: assetClassSeries(segment.key).color }}
            initial={reduceMotion ? false : { scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.55, ease: GROW_EASE }}
          />
        ))}
      </div>
      <ul className="m-0 grid list-none p-0">
        {segments.map((segment) => {
          const series = assetClassSeries(segment.key);
          const target = targets?.[segment.key];
          const delta = target !== undefined ? Math.round((segment.percent - target) * 10) / 10 : null;

          return (
            <li
              className="grid grid-cols-[14px_minmax(64px,0.55fr)_minmax(0,1fr)_52px_minmax(128px,auto)] items-center gap-2.5 border-b border-border py-[7px] last:border-b-0 max-[640px]:grid-cols-[14px_1fr_auto]"
              key={segment.key}
            >
              <LegendSwatch color={series.color} />
              <span className="text-[0.84rem] text-muted-foreground">{series.label}</span>
              <strong className="text-right text-[0.84rem] font-semibold tabular-nums max-[640px]:hidden">{formatMoney(segment.value, currency)}</strong>
              <span className="text-right text-[0.8rem] font-[650] tabular-nums">{formatPercent(segment.percent)}</span>
              {delta !== null ? (
                <span
                  className={cn(
                    "whitespace-nowrap text-right text-[0.74rem] tabular-nums text-muted-foreground max-[640px]:col-span-full max-[640px]:pl-6 max-[640px]:text-left",
                    Math.abs(delta) > 5 && "font-semibold text-warn"
                  )}
                >
                  target {formatPercent(target!)} · {delta > 0 ? "+" : ""}{delta.toLocaleString("pl-PL")} pp
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
