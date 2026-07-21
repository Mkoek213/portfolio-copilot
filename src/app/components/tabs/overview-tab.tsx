import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatDateTime, formatMoney, formatPercent } from "@/lib/format";
import type { DashboardData } from "../../dashboard-data";
import { AllocationStack, CashflowChart, CategoryBars, Sparkline } from "../charts";
import { assetClassSeries } from "../chart-series";
import { PanelHeading, StatTile, StatusChip, riskTone } from "../ui";

type RiskFlag = { level: string; topic: string; message: string };

export function OverviewTab({ data }: { data: DashboardData }) {
  const latestRisks: RiskFlag[] = Array.isArray(data.latestReport?.riskFlags)
    ? (data.latestReport.riskFlags as RiskFlag[])
    : [];
  const activeRisks = latestRisks.filter((risk) => risk.level !== "info");
  const netCashflow = data.monthlyInflow - data.monthlyOutflow;
  const sparkPoints = data.snapshotHistory.map((snapshot) => Number(snapshot.totalValueBase));
  const targets = data.strategy.targetAllocation as Record<string, number>;

  return (
    <>
      <section className="tile-grid" aria-label="Key financial figures">
        <StatTile label="Total portfolio" value={formatMoney(data.totalValue)} hint={data.latestSnapshot ? `as of ${formatDateTime(data.latestSnapshot.createdAt)}` : "live from positions"}>
          <Sparkline points={sparkPoints} ariaLabel="Portfolio value trend across analysis runs" />
        </StatTile>
        <StatTile
          label="Net cashflow this month"
          value={formatMoney(netCashflow)}
          delta={{ text: netCashflow >= 0 ? "saving" : "overspending", good: netCashflow >= 0 }}
          hint={`${formatMoney(data.monthlyInflow)} in`}
        />
        <StatTile
          label="Spending this month"
          value={formatMoney(data.monthlyOutflow)}
          hint={`${data.topCategories.length} ${data.topCategories.length === 1 ? "category" : "categories"}`}
        />
        <StatTile
          label="Active risk flags"
          value={activeRisks.length}
          delta={activeRisks.length > 0 ? { text: "needs attention", good: false } : { text: "all clear", good: true }}
          hint="from latest report"
        />
      </section>

      <section className="grid-2 grid-major" aria-label="Cashflow and latest report">
        <div className="panel">
          <PanelHeading title="Cashflow" sub="Inflow vs outflow · last 6 months" />
          <CashflowChart months={data.monthlyCashflow} />
        </div>

        <div className="panel">
          <PanelHeading title="Latest AI report" sub={data.latestReport ? formatDateTime(data.latestReport.createdAt) : "not generated yet"} />
          {data.latestReport ? (
            <div className="report-teaser">
              <h3>{data.latestReport.title}</h3>
              <div className="chip-row">
                <StatusChip tone={data.latestReport.criticVerdict === "PASS" ? "good" : "warn"} label={`critic ${data.latestReport.criticVerdict.toLowerCase()}`} />
                <span className="chip chip-plain">{data.latestReport.reporterSource}</span>
                <span className="chip chip-plain">{data.latestReport.reportType.toLowerCase()}</span>
              </div>
              <p>{data.latestReport.summary}</p>
              <Link className="text-link" href="/?tab=reports">
                Read the full report <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <p className="empty-state">Run the analysis to generate the first local report.</p>
          )}
        </div>
      </section>

      <section className="grid-2" aria-label="Spending and allocation">
        <div className="panel">
          <PanelHeading title="Spending by category" sub={`${formatMoney(data.monthlyOutflow)} outflow this month`} />
          <CategoryBars items={data.topCategories} />
        </div>

        <div className="panel">
          <PanelHeading title="Portfolio allocation" sub={data.allocationIsLive ? "live from positions" : "from latest analysis run"} />
          <AllocationStack items={data.allocationByClass} targets={targets} totalValue={data.totalValue} />
        </div>
      </section>

      <section className="grid-2 grid-major" aria-label="Positions and risks">
        <div className="panel">
          <PanelHeading title="Positions" sub={`${data.positions.length} holdings · ${new Set(data.positions.map((position) => position.accountId)).size} read-only accounts`} />
          {data.positions.length > 0 ? (
            <div className="table-wrap">
              <table className="data-table positions-table">
                <thead>
                  <tr>
                    <th scope="col">Asset</th>
                    <th scope="col">Account</th>
                    <th scope="col">Class</th>
                    <th scope="col" className="num">Value</th>
                    <th scope="col" className="num">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {data.positions.map((position) => {
                    const weight = data.totalValue > 0 ? (Number(position.marketValueBase) / data.totalValue) * 100 : 0;
                    const series = assetClassSeries(position.asset.assetClass);

                    return (
                      <tr key={position.id}>
                        <td>
                          <strong>{position.asset.symbol}</strong>
                          <span className="cell-sub">{position.asset.name}</span>
                        </td>
                        <td className="cell-muted">{position.account.name}</td>
                        <td>
                          <span className="class-key">
                            <i className="legend-swatch" style={{ background: series.color }} aria-hidden="true" />
                            {series.label}
                          </span>
                        </td>
                        <td className="num">{formatMoney(position.marketValueBase)}</td>
                        <td className="num">
                          {formatPercent(Math.round(weight * 10) / 10)}
                          <span className="weight-meter" aria-hidden="true">
                            <i style={{ width: `${Math.min(weight, 100)}%` }} />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-state">No positions yet. Seed the database to load sample accounts.</p>
          )}
        </div>

        <div className="panel">
          <PanelHeading title="Risk flags" sub={`${latestRisks.length} from latest report`} />
          <div className="risk-list">
            {latestRisks.slice(0, 6).map((risk, index) => (
              <article className="risk-item" key={`${risk.topic}-${index}`}>
                <div className="risk-item-head">
                  <StatusChip tone={riskTone(risk.level)} label={risk.level} />
                  <strong>{risk.topic}</strong>
                </div>
                <p>{risk.message}</p>
              </article>
            ))}
            {latestRisks.length === 0 ? <p className="empty-state">No report risks yet.</p> : null}
          </div>
        </div>
      </section>
    </>
  );
}
