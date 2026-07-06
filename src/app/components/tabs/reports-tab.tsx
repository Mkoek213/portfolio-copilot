import type { Prisma } from "@prisma/client";
import { formatDateTime } from "@/lib/format";
import type { DashboardData } from "../../dashboard-data";
import { MarkdownLite } from "../markdown";
import { StatusChip, riskTone, runStatusTone } from "../ui";

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
      <div className="chip-row">
        <StatusChip tone={report.criticVerdict === "PASS" ? "good" : "warn"} label={`critic ${report.criticVerdict.toLowerCase()}`} />
        <StatusChip tone={runStatusTone(report.run.status)} label={`run ${report.run.status.toLowerCase()}`} />
        <span className="chip chip-plain">{report.reporterSource}</span>
        <span className="chip chip-plain">{report.reporterModel ?? "deterministic"}</span>
        <span className="chip chip-plain">{report.reportType.toLowerCase()}</span>
        {hasRealTransactions ? <StatusChip tone="good" label="real transactions" /> : <span className="chip chip-plain">sample data only</span>}
      </div>
      <p className="meta-line">Run {shortId(report.run.id)} · sources: {sources.length > 0 ? sources.join(", ") : "none saved"}</p>
    </>
  );
}

function ReportRisks({ report }: { report: DashboardData["reports"][number] }) {
  const risks: RiskFlag[] = Array.isArray(report.riskFlags) ? (report.riskFlags as RiskFlag[]) : [];

  if (risks.length === 0) {
    return null;
  }

  return (
    <div className="chip-row report-risk-row">
      {risks.slice(0, 6).map((risk, index) => (
        <StatusChip key={`${risk.topic}-${index}`} tone={riskTone(risk.level)} label={risk.topic} />
      ))}
    </div>
  );
}

export function ReportsTab({ data }: { data: DashboardData }) {
  const [latest, ...older] = data.reports;

  if (!latest) {
    return (
      <section className="stack">
        <div className="panel">
          <p className="empty-state">No reports saved. Run the analysis to generate the first local report.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="stack">
      <article className="panel report-panel">
        <div className="panel-heading">
          <div>
            <h2>{latest.title}</h2>
            <span>{formatDateTime(latest.createdAt)} · latest report</span>
          </div>
        </div>
        <ReportMeta report={latest} />
        <ReportRisks report={latest} />
        <MarkdownLite content={stripTitleHeading(latest.markdown, latest.title)} />
      </article>

      {older.length > 0 ? (
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>Report history</h2>
              <span>{older.length} earlier report{older.length === 1 ? "" : "s"}</span>
            </div>
          </div>
          <div className="report-history-list">
            {older.map((report) => (
              <details className="report-fold" key={report.id}>
                <summary>
                  <span className="report-fold-title">{report.title}</span>
                  <span className="report-fold-meta">
                    {formatDateTime(report.createdAt)} · {report.reporterSource} ·{" "}
                    <span className={report.criticVerdict === "PASS" ? "text-good" : "text-warn"}>critic {report.criticVerdict.toLowerCase()}</span>
                  </span>
                </summary>
                <div className="report-fold-body">
                  <ReportMeta report={report} />
                  <p>{report.summary}</p>
                  <MarkdownLite content={stripTitleHeading(report.markdown, report.title)} />
                </div>
              </details>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
