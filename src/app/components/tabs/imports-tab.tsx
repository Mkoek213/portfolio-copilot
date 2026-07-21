import type { Prisma } from "@prisma/client";
import { FileText, Inbox, Mail } from "lucide-react";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DashboardData } from "../../dashboard-data";
import { DeleteAllResolvedImportsControl, ImportBatchActions, ImportPreviewCategoryControl, ImportPreviewReviewControl, MbankSyncModeControl, RejectAllPendingImportsControl, SyncMbankControl } from "../import-controls";
import { SchedulerNowControl } from "../maintenance-controls";
import { FactGrid, FactRow, SectionCard, StatusChip, importStatusTone } from "../ui";

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

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[0.86rem] text-muted-foreground">
      <Inbox size={16} aria-hidden="true" /> {children}
    </p>
  );
}

export function ImportsTab({ data, gmailState }: { data: DashboardData; gmailState: string }) {
  const pendingCount = data.importBatches.filter((batch) => batch.status === "PENDING_REVIEW").length;
  const hasResolvedImports = data.importBatches.some((batch) => batch.status === "FAILED" || batch.status === "SKIPPED");
  const bannerTone = data.gmailHealth.available
    ? "border-good/25 bg-good-soft"
    : data.gmailHealth.enabled
      ? "border-warn/25 bg-warn-soft"
      : "border-border bg-secondary";

  return (
    <section className="grid grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)] gap-[18px] max-[1160px]:grid-cols-1">
      <SectionCard title="Gmail mBank imports" sub={data.gmailHealth.reason}>
        <div className={cn("mb-3.5 grid gap-2 rounded-md border p-3.5", bannerTone)}>
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusChip tone={data.gmailHealth.available ? "good" : data.gmailHealth.enabled ? "warn" : "muted"} label={`Gmail ${gmailState}`} />
            <strong className="font-mono text-[0.76rem] text-muted-foreground [overflow-wrap:anywhere]">{data.gmailHealth.baseUrl}</strong>
          </div>
          <p className="text-[0.8rem] leading-[1.5] text-muted-foreground">Manual Sync reads mBank daily notifications and monthly statement PDFs. A confirmed statement is authoritative for its month and replaces any daily entries in that period. OAuth and Gmail access stay user-run outside the app.</p>
        </div>
        <p className="mb-3 text-[0.8rem] leading-[1.5] text-muted-foreground">Import mode applies to both Manual Sync and the scheduler. It affects new syncs; existing import previews remain available for review or rejection.</p>
        <MbankSyncModeControl syncMode={data.schedulerState.syncMode} />
        <div className="my-1 flex flex-wrap items-start gap-2">
          <SyncMbankControl syncMode={data.schedulerState.syncMode} />
          {pendingCount > 0 ? <RejectAllPendingImportsControl /> : null}
          {hasResolvedImports ? <DeleteAllResolvedImportsControl /> : null}
        </div>
        <div className="mt-3 grid gap-3">
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
            const CardIcon = isStatement ? FileText : Mail;

            return (
              <article
                className="grid gap-2.5 rounded-lg border border-border p-3.5 transition-[border-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-px hover:border-ring/40 hover:shadow-card"
                key={batch.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <CardIcon size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <strong className="text-[0.88rem] font-semibold [overflow-wrap:anywhere]">{batch.subject ?? batch.gmailMessageId}</strong>
                      <span className="mt-0.5 block text-[0.78rem] text-muted-foreground [overflow-wrap:anywhere]">
                        {isStatement ? "Statement " : ""}{periodLabel} · {batch.transactionCount} transaction{batch.transactionCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                  <StatusChip tone={importStatusTone(batch.status)} label={batch.status.toLowerCase().replace("_", " ")} />
                </div>
                {batch.errorMessage ? <p className="text-[0.82rem] text-crit">{batch.errorMessage}</p> : null}
                <ImportBatchActions batchId={batch.id} status={batch.status} pendingTransactions={pendingPreview.length} acceptedTransactions={acceptedCount} />
                {batch.status === "PENDING_REVIEW" ? (
                  <div className="grid min-w-0 gap-2">
                    <div className="flex items-center gap-2.5 text-[0.78rem] text-muted-foreground">
                      <strong className="font-[650] text-warn">{pendingPreview.length} pending</strong>
                      <span>{acceptedCount} accepted</span>
                      <span>{rejectedCount} rejected</span>
                    </div>
                    <div
                      className="grid max-h-[min(62vh,680px)] gap-2 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]"
                      tabIndex={0}
                      aria-label={`Import transactions: ${pendingPreview.length} pending, ${acceptedCount} accepted, ${rejectedCount} rejected`}
                    >
                      {pendingPreview.map((item) => (
                        <div
                          className="grid grid-cols-[minmax(160px,0.6fr)_auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md border border-transparent bg-secondary px-2.5 py-2 max-[640px]:grid-cols-[auto_minmax(0,1fr)_auto]"
                          key={`${batch.id}-${item.transactionIndex}`}
                        >
                          <div className="max-[640px]:col-span-full">
                            <ImportPreviewCategoryControl batchId={batch.id} transactionIndex={item.transactionIndex} category={String(item.category)} />
                          </div>
                          <ImportPreviewReviewControl batchId={batch.id} transactionIndex={item.transactionIndex} />
                          <strong className="text-[0.84rem] font-medium [overflow-wrap:anywhere]">{String(item.description)}</strong>
                          <span className="whitespace-nowrap text-[0.84rem] font-semibold tabular-nums">{formatMoney(Number(item.amount), String(item.currency ?? "PLN"))}</span>
                        </div>
                      ))}
                      {pendingPreview.length === 0 ? <p className="text-[0.86rem] text-muted-foreground">All transactions reviewed.</p> : null}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
          {data.importBatches.length === 0 ? <EmptyState>No import batches yet.</EmptyState> : null}
        </div>
      </SectionCard>

      <SectionCard title="Scheduler" sub={`${data.schedulerState.timezone} · daily at ${data.schedulerState.timeOfDay}`}>
        <FactGrid>
          <FactRow label="Last sync">{formatDateTime(data.schedulerState.lastRunAt)}</FactRow>
          <FactRow label="Next sync">{formatDateTime(data.schedulerState.nextRunAt)}</FactRow>
          <FactRow label="Status">{data.schedulerState.running ? "running" : data.schedulerState.lastStatus ?? "idle"}</FactRow>
          <FactRow label="Last error">{data.schedulerState.lastError ?? "none"}</FactRow>
        </FactGrid>
        <p className="mb-3 mt-3 text-[0.8rem] leading-[1.5] text-muted-foreground">The scheduler runs only while the Next.js app and Gmail API access are available. Manual Sync remains the real-import gate.</p>
        <SchedulerNowControl />
      </SectionCard>
    </section>
  );
}
