import type { Prisma } from "@prisma/client";
import { FileText, History, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardData } from "../../dashboard-data";
import { MarkdownLite } from "../markdown";
import { SectionCard, StatusChip, riskTone, runStatusTone } from "../ui";

type RiskFlag = { level: string; topic: string; message: string };

function reportSources(value: Prisma.JsonValue | null | undefined) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function shortId(value: string) {
  return value.slice(-8);
}

// The card header already shows the report title, so drop a leading markdown
// H1 that repeats it.
function stripTitleHeading(markdown: string, title: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const firstContent = lines.findIndex((line) => line.trim() !== "");

  if (firstContent >= 0 && lines[firstContent].replace(/^#\s+/, "").trim() === title.trim()) {
    return lines.slice(firstContent + 1).join("\n");
  }

  return markdown;
}

function ReportMeta({ report }: { report: DashboardData["reports"][number] }) {
  const sources = reportSources(report.sources);
  const hasRealTransactions = sources.includes("bank-transactions:mbank-email");

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <StatusChip tone={report.criticVerdict === "PASS" ? "good" : "warn"} label={`critic ${report.criticVerdict.toLowerCase()}`} />
        <StatusChip tone={runStatusTone(report.run.status)} label={`run ${report.run.status.toLowerCase()}`} />
        <Badge variant="muted">{report.reporterSource}</Badge>
        <Badge variant="muted">{report.reporterModel ?? "deterministic"}</Badge>
        <Badge variant="muted">{report.reportType.toLowerCase()}</Badge>
        {hasRealTransactions ? <StatusChip tone="good" label="real transactions" /> : <Badge variant="muted">sample data only</Badge>}
      </div>
      <p className="mb-3 text-[0.78rem] text-muted-foreground [overflow-wrap:anywhere]">Run {shortId(report.run.id)} · sources: {sources.length > 0 ? sources.join(", ") : "none saved"}</p>
    </>
  );
}

function ReportRisks({ report }: { report: DashboardData["reports"][number] }) {
  const risks: RiskFlag[] = Array.isArray(report.riskFlags) ? (report.riskFlags as RiskFlag[]) : [];

  if (risks.length === 0) {
    return null;
  }

  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {risks.slice(0, 6).map((risk, index) => (
        <StatusChip key={`${risk.topic}-${index}`} tone={riskTone(risk.level)} label={risk.topic} />
      ))}
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center gap-2 text-[0.82rem] text-muted-foreground">
        <Loader2 size={16} aria-hidden="true" className="animate-spin" /> Generating a report…
      </div>
      <div className="mt-4 grid gap-2.5">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-4/6" />
      </div>
    </div>
  );
}

export function ReportsTab({ data }: { data: DashboardData }) {
  const [latest, ...older] = data.reports;
  const generating = data.schedulerState.running;

  if (!latest) {
    return (
      <SectionCard title="Reports" sub="Locally generated AI analysis reports" action={<FileText size={18} aria-hidden="true" />}>
        {generating ? <ReportSkeleton /> : <p className="flex items-center gap-2 text-[0.86rem] text-muted-foreground"><FileText size={16} aria-hidden="true" /> No reports saved. Run the analysis to generate the first local report.</p>}
      </SectionCard>
    );
  }

  return (
    <section className="grid gap-[18px]">
      {generating ? <ReportSkeleton /> : null}

      <SectionCard
        title={latest.title}
        sub={`${formatDateTime(latest.createdAt)} · latest report`}
        action={<FileText size={18} aria-hidden="true" />}
      >
        <ReportMeta report={latest} />
        <ReportRisks report={latest} />
        <MarkdownLite content={stripTitleHeading(latest.markdown, latest.title)} />
      </SectionCard>

      {older.length > 0 ? (
        <SectionCard
          title="Report history"
          sub={`${older.length} earlier report${older.length === 1 ? "" : "s"}`}
          action={<History size={18} aria-hidden="true" />}
        >
          <div className="overflow-hidden rounded-lg border border-border">
            <Accordion type="single" collapsible>
              {older.map((report) => (
                <AccordionItem value={report.id} key={report.id} className="px-3.5">
                  <AccordionTrigger>
                    <div className="grid gap-0.5 pr-2 text-left">
                      <span className="text-[0.86rem] font-semibold">{report.title}</span>
                      <span className="text-[0.76rem] font-normal text-muted-foreground">
                        {formatDateTime(report.createdAt)} · {report.reporterSource} ·{" "}
                        <span className={cn(report.criticVerdict === "PASS" ? "text-good" : "text-warn")}>critic {report.criticVerdict.toLowerCase()}</span>
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ReportMeta report={report} />
                    <p className="mb-2.5 text-[0.86rem] text-muted-foreground">{report.summary}</p>
                    <MarkdownLite content={stripTitleHeading(report.markdown, report.title)} />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </SectionCard>
      ) : null}
    </section>
  );
}
