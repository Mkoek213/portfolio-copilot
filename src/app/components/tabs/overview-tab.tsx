import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatDateTime, formatMoney, formatPercent } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DashboardData } from "../../dashboard-data";
import { AllocationStack, CashflowChart, CategoryBars, Sparkline } from "../charts";
import { assetClassSeries } from "../chart-series";
import { SectionCard, StatTile, StatusChip, riskTone } from "../ui";

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
      <section className="grid grid-cols-4 gap-3.5 max-[1160px]:grid-cols-2 max-[640px]:grid-cols-1" aria-label="Key financial figures">
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

      <section className="grid grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)] gap-[18px] max-[1160px]:grid-cols-1" aria-label="Cashflow and latest report">
        <SectionCard title="Cashflow" sub="Inflow vs outflow · last 6 months">
          <CashflowChart months={data.monthlyCashflow} />
        </SectionCard>

        <SectionCard title="Latest AI report" sub={data.latestReport ? formatDateTime(data.latestReport.createdAt) : "not generated yet"}>
          {data.latestReport ? (
            <div className="grid gap-2.5">
              <h3 className="text-[0.95rem] font-[650] leading-[1.35]">{data.latestReport.title}</h3>
              <div className="flex flex-wrap gap-1.5">
                <StatusChip tone={data.latestReport.criticVerdict === "PASS" ? "good" : "warn"} label={`critic ${data.latestReport.criticVerdict.toLowerCase()}`} />
                <Badge variant="muted">{data.latestReport.reporterSource}</Badge>
                <Badge variant="muted">{data.latestReport.reportType.toLowerCase()}</Badge>
              </div>
              <p className="text-[0.88rem] leading-[1.55] text-foreground/80">{data.latestReport.summary}</p>
              <Link className="inline-flex items-center gap-1.5 text-[0.85rem] font-semibold text-brand-strong hover:underline" href="/?tab=reports">
                Read the full report <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <p className="text-[0.86rem] text-muted-foreground">Run the analysis to generate the first local report.</p>
          )}
        </SectionCard>
      </section>

      <section className="grid grid-cols-2 gap-[18px] max-[1160px]:grid-cols-1" aria-label="Spending and allocation">
        <SectionCard title="Spending by category" sub={`${formatMoney(data.monthlyOutflow)} outflow this month`}>
          <CategoryBars items={data.topCategories} />
        </SectionCard>

        <SectionCard title="Portfolio allocation" sub={data.allocationIsLive ? "live from positions" : "from latest analysis run"}>
          <AllocationStack items={data.allocationByClass} targets={targets} totalValue={data.totalValue} />
        </SectionCard>
      </section>

      <section className="grid grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)] gap-[18px] max-[1160px]:grid-cols-1" aria-label="Positions and risks">
        <SectionCard title="Positions" sub={`${data.positions.length} holdings · ${new Set(data.positions.map((position) => position.accountId)).size} read-only accounts`} contentClassName="px-0">
          {data.positions.length > 0 ? (
            <Table className="min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4 text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Asset</TableHead>
                  <TableHead className="text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Account</TableHead>
                  <TableHead className="text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Class</TableHead>
                  <TableHead className="text-right text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Value</TableHead>
                  <TableHead className="pr-4 text-right text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Weight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.positions.map((position) => {
                  const weight = data.totalValue > 0 ? (Number(position.marketValueBase) / data.totalValue) * 100 : 0;
                  const series = assetClassSeries(position.asset.assetClass);

                  return (
                    <TableRow key={position.id}>
                      <TableCell className="whitespace-normal py-2.5 pl-4 align-top">
                        <strong className="font-semibold">{position.asset.symbol}</strong>
                        <span className="mt-0.5 block text-[0.78rem] text-muted-foreground [overflow-wrap:anywhere]">{position.asset.name}</span>
                      </TableCell>
                      <TableCell className="py-2.5 align-top text-muted-foreground">{position.account.name}</TableCell>
                      <TableCell className="py-2.5 align-top">
                        <span className="inline-flex items-center gap-[7px] whitespace-nowrap text-[0.82rem] text-muted-foreground">
                          <i className="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ background: series.color }} aria-hidden="true" />
                          {series.label}
                        </span>
                      </TableCell>
                      <TableCell className="py-2.5 text-right align-top tabular-nums">{formatMoney(position.marketValueBase)}</TableCell>
                      <TableCell className="py-2.5 pr-4 text-right align-top tabular-nums">
                        {formatPercent(Math.round(weight * 10) / 10)}
                        <span className="mt-[5px] ml-auto block h-1 w-[76px] overflow-hidden rounded-full bg-secondary" aria-hidden="true">
                          <i className="block h-full rounded-full bg-[#2a78d6]" style={{ width: `${Math.min(weight, 100)}%` }} />
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-[0.86rem] text-muted-foreground">No positions yet. Seed the database to load sample accounts.</p>
          )}
        </SectionCard>

        <SectionCard title="Risk flags" sub={`${latestRisks.length} from latest report`}>
          <div className="grid">
            {latestRisks.slice(0, 6).map((risk, index) => (
              <article className="border-b border-border py-[11px] first:pt-0 last:border-0 last:pb-0" key={`${risk.topic}-${index}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip tone={riskTone(risk.level)} label={risk.level} />
                  <strong className="text-[0.86rem] font-semibold">{risk.topic}</strong>
                </div>
                <p className="mt-1.5 text-[0.84rem] leading-[1.5] text-muted-foreground">{risk.message}</p>
              </article>
            ))}
            {latestRisks.length === 0 ? <p className="text-[0.86rem] text-muted-foreground">No report risks yet.</p> : null}
          </div>
        </SectionCard>
      </section>
    </>
  );
}
