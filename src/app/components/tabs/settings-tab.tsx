import { formatDateTime } from "@/lib/format";
import type { DashboardData } from "../../dashboard-data";
import { RetentionCleanupControl } from "../maintenance-controls";
import { PanelHeading, StatusChip } from "../ui";

export function SettingsTab({ data }: { data: DashboardData }) {
  return (
    <section className="stack">
      <div className="grid-2">
        <div className="panel">
          <PanelHeading title="Local services" sub="No external LLM providers are ever used" />
          <div className="fact-grid">
            <div>
              <span>Ollama</span>
              <StatusChip tone={data.localLlmHealth.available ? "good" : "warn"} label={data.localLlmHealth.available ? "available" : "unavailable"} />
            </div>
            <div><span>Model</span><strong>{data.localLlmHealth.model}</strong></div>
            <div>
              <span>Gmail</span>
              <StatusChip tone={data.gmailHealth.available ? "good" : data.gmailHealth.enabled ? "warn" : "muted"} label={data.gmailHealth.enabled ? (data.gmailHealth.available ? "available" : "unavailable") : "disabled"} />
            </div>
            <div>
              <span>Langfuse</span>
              <StatusChip tone={data.langfuseStatus.available ? "good" : "muted"} label={data.langfuseStatus.available ? "available" : "off"} />
            </div>
          </div>
          <p className="helper-copy">{data.gmailHealth.reason} · {data.langfuseStatus.reason}</p>
        </div>
        <div className="panel">
          <PanelHeading title="Retention" sub="Reports, runs, events and trace spans are kept for about 3 months" />
          <RetentionCleanupControl />
        </div>
      </div>
      <div className="panel">
        <PanelHeading title="Trace spans" sub={`${data.traceSpans.length} latest · ${data.runCount} runs total`} />
        {data.traceSpans.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Span</th>
                  <th scope="col">Status</th>
                  <th scope="col">Level</th>
                  <th scope="col" className="num">Started</th>
                </tr>
              </thead>
              <tbody>
                {data.traceSpans.map((span) => (
                  <tr key={span.id}>
                    <td>
                      <strong>{span.name}</strong>
                      <span className="cell-sub">trace {span.traceId.slice(-10)}</span>
                    </td>
                    <td>
                      <StatusChip
                        tone={span.status === "OK" ? "good" : span.status === "ERROR" ? "crit" : span.status === "WARN" ? "warn" : "info"}
                        label={span.status.toLowerCase()}
                      />
                    </td>
                    <td className="cell-muted">{span.level.toLowerCase()}</td>
                    <td className="num cell-muted">{formatDateTime(span.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">No trace spans yet.</p>
        )}
      </div>
    </section>
  );
}
