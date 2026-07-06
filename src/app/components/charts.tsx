import { formatMoney, formatMoneyExact, formatMonthLabel, formatNumber, formatPercent } from "@/lib/format";
import { expenseCategoryLabel } from "@/domain/portfolio/categories";
import type { CategoryTotal, MonthlyCashflow } from "../dashboard-data";

/**
 * Chart colors follow the validated categorical palette (fixed slot order,
 * CVD-checked). Asset classes keep a fixed color everywhere in the app so a
 * class never changes hue between renders or panels.
 */
export const ASSET_CLASS_SERIES: Array<{ key: string; label: string; color: string }> = [
  { key: "ETF_STOCK", label: "ETF", color: "#2a78d6" },
  { key: "STOCK", label: "Stocks", color: "#1baf7a" },
  { key: "BOND", label: "Bonds", color: "#eda100" },
  { key: "CASH", label: "Cash", color: "#008300" },
  { key: "CRYPTO", label: "Crypto", color: "#4a3aa7" },
  { key: "COMMODITY", label: "Commodities", color: "#e34948" },
  { key: "OTHER", label: "Other", color: "#e87ba4" }
];

const INFLOW_COLOR = "#1baf7a";
const OUTFLOW_COLOR = "#2a78d6";
const SINGLE_SERIES_COLOR = "#2a78d6";

export function assetClassSeries(key: string) {
  return ASSET_CLASS_SERIES.find((series) => series.key === key) ?? { key, label: key, color: "#898781" };
}

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
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      <path d={path} fill="none" stroke="var(--spark-line)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r="3.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
    </svg>
  );
}

export function CashflowChart({ months, currency = "PLN" }: { months: MonthlyCashflow[]; currency?: string }) {
  const peak = Math.max(...months.map((month) => Math.max(month.inflow, month.outflow)));

  if (peak <= 0) {
    return <p className="empty-state">No imported transactions in the last 6 months yet.</p>;
  }

  const top = niceCeiling(peak);
  const ticks = [top, top / 2, 0];

  return (
    <figure className="colchart" aria-label={`Monthly inflow and outflow for the last ${months.length} months`}>
      <div className="viz-legend" aria-hidden="true">
        <span><i className="legend-swatch" style={{ background: INFLOW_COLOR }} /> Inflow</span>
        <span><i className="legend-swatch" style={{ background: OUTFLOW_COLOR }} /> Outflow</span>
      </div>
      <div className="colchart-body">
        <div className="colchart-y" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick}>{formatNumber(tick)}</span>
          ))}
        </div>
        <div className="colchart-main">
          <div className="colchart-area">
            <div className="colchart-grid" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="colchart-groups">
              {months.map((month) => (
                <div className="colgroup" key={month.month} tabIndex={0} aria-label={`${formatMonthLabel(month.month)}: inflow ${formatMoney(month.inflow, currency)}, outflow ${formatMoney(month.outflow, currency)}`}>
                  <div className="colgroup-bars" aria-hidden="true">
                    <span className="colbar" style={{ height: `${(month.inflow / top) * 100}%`, background: INFLOW_COLOR }} />
                    <span className="colbar" style={{ height: `${(month.outflow / top) * 100}%`, background: OUTFLOW_COLOR }} />
                  </div>
                  <div className="viz-tip" role="presentation">
                    <strong>{formatMonthLabel(month.month)} {month.month.slice(0, 4)}</strong>
                    <span><i className="legend-line" style={{ background: INFLOW_COLOR }} /><em>{formatMoney(month.inflow, currency)}</em> inflow</span>
                    <span><i className="legend-line" style={{ background: OUTFLOW_COLOR }} /><em>{formatMoney(month.outflow, currency)}</em> outflow</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="colchart-labels" aria-hidden="true">
            {months.map((month) => (
              <span key={month.month}>{formatMonthLabel(month.month)}</span>
            ))}
          </div>
        </div>
      </div>
      <details className="viz-table">
        <summary>View data table</summary>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col" className="num">Inflow</th>
              <th scope="col" className="num">Outflow</th>
              <th scope="col" className="num">Net</th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={month.month}>
                <td>{formatMonthLabel(month.month)} {month.month.slice(0, 4)}</td>
                <td className="num">{formatMoneyExact(month.inflow, currency)}</td>
                <td className="num">{formatMoneyExact(month.outflow, currency)}</td>
                <td className="num">{formatMoneyExact(month.inflow - month.outflow, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export function CategoryBars({ items, currency = "PLN" }: { items: CategoryTotal[]; currency?: string }) {
  if (items.length === 0) {
    return <p className="empty-state">No imported spending for the current month.</p>;
  }

  const max = Math.max(...items.map((item) => item.value));

  return (
    <div className="catbars">
      {items.map((item) => {
        const label = item.category === "__rest__" ? "other categories" : expenseCategoryLabel(item.category);

        return (
          <div className="catbar-row" key={item.category}>
            <span className="catbar-label">{label}</span>
            <div className="catbar-track" aria-hidden="true">
              <span className="catbar-fill" style={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%`, background: SINGLE_SERIES_COLOR }} />
            </div>
            <span className="catbar-value">{formatMoney(item.value, currency)}</span>
            <span className="catbar-percent">{formatPercent(item.percent)}</span>
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
  if (items.length === 0 || totalValue <= 0) {
    return <p className="empty-state">No portfolio positions yet. Seed the database or run an import.</p>;
  }

  // Segments render in the fixed series order so adjacency (and the CVD check
  // behind it) stays deterministic no matter how values shift.
  const ordered = ASSET_CLASS_SERIES
    .map((series) => items.find((item) => item.key === series.key))
    .filter((item): item is NonNullable<typeof item> => Boolean(item) && item!.value > 0);
  const unknown = items.filter((item) => item.value > 0 && !ASSET_CLASS_SERIES.some((series) => series.key === item.key));
  const segments = [...ordered, ...unknown];

  return (
    <div className="alloc">
      <div className="alloc-bar" role="img" aria-label={segments.map((segment) => `${assetClassSeries(segment.key).label} ${formatPercent(segment.percent)}`).join(", ")}>
        {segments.map((segment) => (
          <span
            key={segment.key}
            className="alloc-segment"
            style={{ width: `${segment.percent}%`, background: assetClassSeries(segment.key).color }}
          />
        ))}
      </div>
      <ul className="alloc-legend">
        {segments.map((segment) => {
          const series = assetClassSeries(segment.key);
          const target = targets?.[segment.key];
          const delta = target !== undefined ? Math.round((segment.percent - target) * 10) / 10 : null;

          return (
            <li key={segment.key}>
              <i className="legend-swatch" style={{ background: series.color }} aria-hidden="true" />
              <span className="alloc-label">{series.label}</span>
              <strong className="alloc-value">{formatMoney(segment.value, currency)}</strong>
              <span className="alloc-percent">{formatPercent(segment.percent)}</span>
              {delta !== null ? (
                <span className={Math.abs(delta) > 5 ? "alloc-target off-target" : "alloc-target"}>
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
