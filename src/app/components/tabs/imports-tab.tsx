import type { Prisma } from "@prisma/client";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { DashboardData } from "../../dashboard-data";
import { DeleteAllResolvedImportsControl, ImportBatchActions, ImportPreviewCategoryControl, ImportPreviewReviewControl, MbankSyncModeControl, RejectAllPendingImportsControl, SyncMbankControl } from "../import-controls";
import { SchedulerNowControl } from "../maintenance-controls";
import { PanelHeading, StatusChip, importStatusTone } from "../ui";

type PreviewTransaction = Record<string, unknown> & {
  description: string;
  amount: number;
  reviewStatus: "PENDING" | "ACCEPTED" | "REJECTED";
  transactionIndex: number;
};

function parsedPreview(value: Prisma.JsonValue | null | undefined): PreviewTransaction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, transactionIndex): Record<string, unknown> & { transactionIndex: number } => ({
      ...(item as Record<string, unknown>),
      transactionIndex
    }))
    .filter((item): item is Record<string, unknown> & { description: string; amount: number; transactionIndex: number } =>
      typeof item.description === "string" && typeof item.amount === "number"
    )
    .map((item) => ({
      ...item,
      reviewStatus:
        item.reviewStatus === "ACCEPTED" || item.reviewStatus === "REJECTED" || item.reviewStatus === "PENDING"
          ? item.reviewStatus
          : item.included === false
            ? "REJECTED"
            : "PENDING"
    }));
}

export function ImportsTab({ data, gmailState }: { data: DashboardData; gmailState: string }) {
  const pendingCount = data.importBatches.filter((batch) => batch.status === "PENDING_REVIEW").length;
  const hasResolvedImports = data.importBatches.some((batch) => batch.status === "FAILED" || batch.status === "SKIPPED");

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
        <p className="helper-copy">Import mode applies to both Manual Sync and the scheduler. It affects new syncs; existing import previews remain available for review or rejection.</p>
        <MbankSyncModeControl syncMode={data.schedulerState.syncMode} />
        <div className="review-actions inline-action">
          <SyncMbankControl syncMode={data.schedulerState.syncMode} />
          {pendingCount > 0 ? <RejectAllPendingImportsControl /> : null}
          {hasResolvedImports ? <DeleteAllResolvedImportsControl /> : null}
        </div>
        <div className="import-list">
          {data.importBatches.map((batch) => {
            const isStatement = batch.provider === "MBANK_STATEMENT";
            const preview = parsedPreview(batch.parsedTransactions);
            const pendingPreview = preview.filter((item) => item.reviewStatus === "PENDING");
            const acceptedCount = preview.filter((item) => item.reviewStatus === "ACCEPTED").length;
            const rejectedCount = preview.filter((item) => item.reviewStatus === "REJECTED").length;
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
              <ImportBatchActions batchId={batch.id} status={batch.status} pendingTransactions={pendingPreview.length} acceptedTransactions={acceptedCount} />
              {batch.status === "PENDING_REVIEW" ? (
                <div className="preview-shell">
                  <div className="preview-summary">
                    <strong>{pendingPreview.length} pending</strong>
                    <span>{acceptedCount} accepted</span>
                    <span>{rejectedCount} rejected</span>
                  </div>
                  <div className="preview-list" tabIndex={0} aria-label={`Import transactions: ${pendingPreview.length} pending, ${acceptedCount} accepted, ${rejectedCount} rejected`}>
                    {pendingPreview.map((item) => (
                      <div className="preview-row" key={`${batch.id}-${item.transactionIndex}`}>
                        <ImportPreviewCategoryControl batchId={batch.id} transactionIndex={item.transactionIndex} category={String(item.category)} />
                        <ImportPreviewReviewControl batchId={batch.id} transactionIndex={item.transactionIndex} />
                        <strong>{String(item.description)}</strong>
                        <span>{formatMoney(Number(item.amount), String(item.currency ?? "PLN"))}</span>
                      </div>
                    ))}
                    {pendingPreview.length === 0 ? <p className="empty-state">All transactions reviewed.</p> : null}
                  </div>
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
