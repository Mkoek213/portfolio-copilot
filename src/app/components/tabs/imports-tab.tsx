import type { Prisma } from "@prisma/client";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { DashboardData } from "../../dashboard-data";
import { ImportBatchActions, ImportPreviewCategoryControl, RejectAllPendingImportsControl, SyncMbankControl } from "../import-controls";
import { SchedulerNowControl } from "../maintenance-controls";
import { PanelHeading, StatusChip, importStatusTone } from "../ui";

function parsedPreview(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => item as Record<string, unknown>)
    .filter((item) => typeof item.description === "string" && typeof item.amount === "number")
    .slice(0, 8);
}

export function ImportsTab({ data, gmailState }: { data: DashboardData; gmailState: string }) {
  const pendingCount = data.importBatches.filter((batch) => batch.status === "PENDING_REVIEW").length;

  return (
    <section className="grid-2 grid-major">
      <div className="panel">
        <PanelHeading title="Gmail mBank imports" sub={data.gmailHealth.reason} />
        <div className={`service-banner ${data.gmailHealth.available ? "service-ok" : data.gmailHealth.enabled ? "service-warn" : "service-muted"}`}>
          <div className="service-banner-head">
            <StatusChip tone={data.gmailHealth.available ? "good" : data.gmailHealth.enabled ? "warn" : "muted"} label={`Gmail ${gmailState}`} />
            <strong>{data.gmailHealth.baseUrl}</strong>
          </div>
          <p>Manual Sync reads mBank daily notifications and monthly statement PDFs. A confirmed statement is authoritative for its month and replaces any daily entries in that period. OAuth and Gmail access stay user-run outside the app.</p>
        </div>
        <div className="review-actions inline-action">
          <SyncMbankControl />
          {pendingCount > 0 ? <RejectAllPendingImportsControl /> : null}
        </div>
        <div className="import-list">
          {data.importBatches.map((batch) => {
            const isStatement = batch.provider === "MBANK_STATEMENT";
            const periodLabel =
              isStatement && batch.periodStart && batch.periodEnd
                ? `${formatDate(batch.periodStart)} - ${formatDate(batch.periodEnd)}`
                : formatDate(batch.operationDate);

            return (
            <article className="import-card" key={batch.id}>
              <div className="import-card-head">
                <div>
                  <strong>{batch.subject ?? batch.gmailMessageId}</strong>
                  <span className="cell-sub">
                    {isStatement ? "Statement " : ""}{periodLabel} · {batch.transactionCount} transaction{batch.transactionCount === 1 ? "" : "s"}
                  </span>
                </div>
                <StatusChip tone={importStatusTone(batch.status)} label={batch.status.toLowerCase().replace("_", " ")} />
              </div>
              {batch.errorMessage ? <p className="error-copy">{batch.errorMessage}</p> : null}
              <ImportBatchActions batchId={batch.id} status={batch.status} />
              {batch.status === "PENDING_REVIEW" ? (
                <div className="preview-list">
                  {parsedPreview(batch.parsedTransactions).map((item, index) => (
                    <div className="preview-row" key={`${batch.id}-${index}`}>
                      <ImportPreviewCategoryControl batchId={batch.id} transactionIndex={index} category={String(item.category)} />
                      <strong>{String(item.description)}</strong>
                      <span>{formatMoney(Number(item.amount), String(item.currency ?? "PLN"))}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
            );
          })}
          {data.importBatches.length === 0 ? <p className="empty-state">No import batches yet.</p> : null}
        </div>
      </div>

      <div className="panel">
        <PanelHeading title="Scheduler" sub={`${data.schedulerState.timezone} · daily at ${data.schedulerState.timeOfDay}`} />
        <div className="fact-grid">
          <div><span>Last sync</span><strong>{formatDateTime(data.schedulerState.lastRunAt)}</strong></div>
          <div><span>Next sync</span><strong>{formatDateTime(data.schedulerState.nextRunAt)}</strong></div>
          <div><span>Status</span><strong>{data.schedulerState.running ? "running" : data.schedulerState.lastStatus ?? "idle"}</strong></div>
          <div><span>Last error</span><strong>{data.schedulerState.lastError ?? "none"}</strong></div>
        </div>
        <p className="helper-copy">The scheduler runs only while the Next.js app and Gmail API access are available. Manual Sync remains the real-import gate.</p>
        <SchedulerNowControl />
      </div>
    </section>
  );
}
