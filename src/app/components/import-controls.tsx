"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, Loader2, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import { EXPENSE_CATEGORY_OPTIONS } from "@/domain/portfolio/categories";
import { MBANK_SYNC_MODE_OPTIONS } from "@/domain/imports/mbank-sync-mode";
import type { MbankSyncMode } from "@prisma/client";
import { Button as UiButton } from "@/components/ui/button";
import { confirmImportAction, deleteAllResolvedImportsAction, deleteImportAction, rejectAllPendingImportsAction, rejectImportAction, retryImportParseAction, syncMbankGmailAction, updateImportPreviewCategoryAction, updateImportPreviewReviewAction, updateMbankSyncModeAction, updateTransactionCategoryAction, type ActionResult } from "../actions";
import { ActionStatus } from "./action-status";

const initialState: ActionResult = { status: "idle", message: "" };

// Native <select> chrome shared by CategorySelect and the sync-mode select.
// Explicit bg-background text-foreground keeps the option list correct in dark
// mode (incl. Windows chrome). See plan 16.
const selectClass =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-[0.8rem] text-foreground outline-none transition-colors hover:border-ring/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-wait disabled:opacity-65";
const stackClass = "my-1 grid justify-items-start gap-2.5";

type ImportActionKind = "sync" | "confirm" | "reject" | "retry" | "reject-all" | "delete" | "delete-all";

function hasKnownCategory(category: string) {
  return EXPENSE_CATEGORY_OPTIONS.some((option) => option.value === category);
}

function CategorySelect({ category, label }: { category: string; label: string }) {
  const { pending } = useFormStatus();
  const [value, setValue] = useState(category);

  useEffect(() => {
    setValue(category);
  }, [category]);

  return (
    <select
      className={selectClass}
      name="category"
      value={value}
      disabled={pending}
      aria-busy={pending}
      aria-label={label}
      onChange={(event) => {
        setValue(event.currentTarget.value);
        event.currentTarget.form?.requestSubmit();
      }}
    >
      {hasKnownCategory(category) ? null : <option value={category}>{category}</option>}
      {EXPENSE_CATEGORY_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

function Button({ kind, children, disabled = false, title }: { kind: ImportActionKind; children: React.ReactNode; disabled?: boolean; title?: string }) {
  const { pending } = useFormStatus();
  const Icon = pending
    ? Loader2
    : kind === "sync"
      ? RefreshCw
      : kind === "confirm"
        ? Check
        : kind === "retry"
          ? RotateCcw
          : kind === "delete" || kind === "delete-all"
            ? Trash2
            : X;
  const isGhost = kind === "reject" || kind === "reject-all" || kind === "delete" || kind === "delete-all";

  return (
    <UiButton variant={isGhost ? "destructive-outline" : "outline"} size="sm" type="submit" disabled={pending || disabled} aria-busy={pending} title={title}>
      <Icon className={pending ? "animate-spin" : undefined} size={16} aria-hidden="true" />
      {children}
    </UiButton>
  );
}

export function SyncMbankControl({ syncMode }: { syncMode: MbankSyncMode }) {
  const [state, action] = useActionState(syncMbankGmailAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status, state.timestamp]);

  return (
    <div className={stackClass}>
      <form action={action}>
        <Button kind="sync">{syncMode === "STATEMENT_ONLY" ? "Sync statements now" : syncMode === "DAILY_ONLY" ? "Sync notifications now" : "Sync now"}</Button>
      </form>
      <ActionStatus state={state} />
    </div>
  );
}

function SyncModeSaveButton() {
  const { pending } = useFormStatus();

  return (
    <UiButton variant="outline" size="icon" type="submit" disabled={pending} aria-busy={pending} aria-label="Save import mode" title="Save import mode" className="text-brand-strong">
      {pending ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
    </UiButton>
  );
}

export function MbankSyncModeControl({ syncMode }: { syncMode: MbankSyncMode }) {
  const [state, action] = useActionState(updateMbankSyncModeAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status, state.timestamp]);

  return (
    <div className={stackClass}>
      <form className="grid w-full grid-cols-[minmax(130px,1fr)_auto] items-center gap-1.5" action={action}>
        <select className={selectClass} name="syncMode" defaultValue={syncMode} aria-label="mBank import mode">
          {MBANK_SYNC_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <SyncModeSaveButton />
      </form>
      <ActionStatus state={state} />
    </div>
  );
}

export function RejectAllPendingImportsControl() {
  const [state, action] = useActionState(rejectAllPendingImportsAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status, state.timestamp]);

  return (
    <div className={stackClass}>
      <form action={action}>
        <Button kind="reject-all">Reject all pending</Button>
      </form>
      <ActionStatus state={state} />
    </div>
  );
}

export function DeleteAllResolvedImportsControl() {
  const [state, action] = useActionState(deleteAllResolvedImportsAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status, state.timestamp]);

  return (
    <div className={stackClass}>
      <form action={action}>
        <Button kind="delete-all">Delete failed/skipped</Button>
      </form>
      <ActionStatus state={state} />
    </div>
  );
}

export function ImportBatchActions({
  batchId,
  status,
  pendingTransactions = 0,
  acceptedTransactions = 0
}: {
  batchId: string;
  status: string;
  pendingTransactions?: number;
  acceptedTransactions?: number;
}) {
  const [confirmState, confirmAction] = useActionState(confirmImportAction, initialState);
  const [rejectState, rejectAction] = useActionState(rejectImportAction, initialState);
  const [retryState, retryAction] = useActionState(retryImportParseAction, initialState);
  const [deleteState, deleteAction] = useActionState(deleteImportAction, initialState);
  const router = useRouter();
  const canConfirm = status === "PENDING_REVIEW";
  const canRetry = status === "PENDING_REVIEW" || status === "FAILED" || status === "SKIPPED";
  const canReject = status === "PENDING_REVIEW" || status === "FAILED" || status === "SKIPPED";
  const canDelete = status === "FAILED" || status === "SKIPPED";
  const confirmDisabled = pendingTransactions > 0 || acceptedTransactions === 0;
  const confirmTitle = pendingTransactions > 0 ? `Review ${pendingTransactions} remaining transaction(s) first` : acceptedTransactions === 0 ? "Accept at least one transaction first" : undefined;
  const visibleState = [confirmState, retryState, rejectState, deleteState].find((state) => state.status !== "idle") ?? initialState;

  useEffect(() => {
    if (confirmState.status === "success" || rejectState.status === "success" || retryState.status === "success" || deleteState.status === "success") {
      router.refresh();
    }
  }, [confirmState.status, rejectState.status, retryState.status, deleteState.status, confirmState.timestamp, rejectState.timestamp, retryState.timestamp, deleteState.timestamp, router]);

  if (!canConfirm && !canRetry && !canReject && !canDelete) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-start gap-2">
      {canConfirm ? (
        <form action={confirmAction}>
          <input type="hidden" name="batchId" value={batchId} />
          <Button kind="confirm" disabled={confirmDisabled} title={confirmTitle}>Confirm import</Button>
        </form>
      ) : null}
      {canRetry ? (
        <form action={retryAction}>
          <input type="hidden" name="batchId" value={batchId} />
          <Button kind="retry">Retry parse</Button>
        </form>
      ) : null}
      {canReject ? (
        <form action={rejectAction}>
          <input type="hidden" name="batchId" value={batchId} />
          <Button kind="reject">Reject</Button>
        </form>
      ) : null}
      {canDelete ? (
        <form action={deleteAction}>
          <input type="hidden" name="batchId" value={batchId} />
          <Button kind="delete">Delete</Button>
        </form>
      ) : null}
      <ActionStatus state={visibleState} />
    </div>
  );
}


function ReviewDecisionButton({ reviewStatus, label }: { reviewStatus: "ACCEPTED" | "REJECTED"; label: string }) {
  const { pending } = useFormStatus();
  const Icon = reviewStatus === "ACCEPTED" ? Check : X;

  return (
    <UiButton
      variant="outline"
      size="icon"
      type="submit"
      name="reviewStatus"
      value={reviewStatus}
      disabled={pending}
      aria-busy={pending}
      aria-label={label}
      title={label}
      className={
        reviewStatus === "ACCEPTED"
          ? "text-muted-foreground hover:border-good/40 hover:bg-good-soft hover:text-good"
          : "text-muted-foreground hover:border-crit/40 hover:bg-crit-soft hover:text-crit"
      }
    >
      <Icon size={16} aria-hidden="true" />
    </UiButton>
  );
}

export function ImportPreviewReviewControl({ batchId, transactionIndex }: { batchId: string; transactionIndex: number }) {
  const [state, action] = useActionState(updateImportPreviewReviewAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status, state.timestamp]);

  return (
    <div className="min-w-0">
      <form className="grid grid-cols-[repeat(2,2rem)] gap-1" action={action}>
        <input type="hidden" name="batchId" value={batchId} />
        <input type="hidden" name="transactionIndex" value={transactionIndex} />
        <ReviewDecisionButton reviewStatus="ACCEPTED" label="Accept transaction" />
        <ReviewDecisionButton reviewStatus="REJECTED" label="Reject transaction" />
      </form>
      {state.status === "error" ? <ActionStatus state={state} /> : null}
    </div>
  );
}

export function ImportPreviewCategoryControl({ batchId, transactionIndex, category }: { batchId: string; transactionIndex: number; category: string }) {
  const [state, action] = useActionState(updateImportPreviewCategoryAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status, state.timestamp]);

  return (
    <form className="grid min-w-0 items-center gap-1.5" action={action}>
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="transactionIndex" value={transactionIndex} />
      <CategorySelect category={category} label="Import preview category" />
      {state.status === "error" ? <ActionStatus state={state} /> : null}
    </form>
  );
}

export function TransactionCategoryControl({ transactionId, category }: { transactionId: string; category: string }) {
  const [state, action] = useActionState(updateTransactionCategoryAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status, state.timestamp]);

  return (
    <form className="grid min-w-0 items-center gap-1.5" action={action}>
      <input type="hidden" name="transactionId" value={transactionId} />
      <CategorySelect category={category} label="Transaction category" />
      {state.status === "error" ? <ActionStatus state={state} /> : null}
    </form>
  );
}
