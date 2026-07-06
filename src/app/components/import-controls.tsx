"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import { EXPENSE_CATEGORY_OPTIONS } from "@/domain/portfolio/categories";
import { confirmImportAction, rejectImportAction, retryImportParseAction, syncMbankGmailAction, updateImportPreviewCategoryAction, updateTransactionCategoryAction, type ActionResult } from "../actions";
import { ActionStatus } from "./action-status";

const initialState: ActionResult = { status: "idle", message: "" };

type ImportActionKind = "sync" | "confirm" | "reject" | "retry";

function hasKnownCategory(category: string) {
  return EXPENSE_CATEGORY_OPTIONS.some((option) => option.value === category);
}

function CategorySaveButton() {
  const { pending } = useFormStatus();

  return (
    <button className="category-save-button" type="submit" disabled={pending} aria-busy={pending} aria-label="Save category" title="Save category">
      {pending ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
    </button>
  );
}

function CategorySelect({ category, label }: { category: string; label: string }) {
  return (
    <select className="category-select" name="category" defaultValue={category} aria-label={label}>
      {hasKnownCategory(category) ? null : <option value={category}>{category}</option>}
      {EXPENSE_CATEGORY_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

function Button({ kind, children }: { kind: ImportActionKind; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  const Icon = pending ? Loader2 : kind === "sync" ? RefreshCw : kind === "confirm" ? Check : kind === "retry" ? RotateCcw : X;

  return (
    <button className={kind === "reject" ? "ghost-button" : "secondary-button"} type="submit" disabled={pending} aria-busy={pending}>
      <Icon className={pending ? "spin" : undefined} size={18} aria-hidden="true" />
      {children}
    </button>
  );
}

export function SyncMbankControl() {
  const [state, action] = useActionState(syncMbankGmailAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status, state.timestamp]);

  return (
    <div className="action-stack inline-action">
      <form action={action}>
        <Button kind="sync">Sync now</Button>
      </form>
      <ActionStatus state={state} />
    </div>
  );
}

export function ImportBatchActions({ batchId, status }: { batchId: string; status: string }) {
  const [confirmState, confirmAction] = useActionState(confirmImportAction, initialState);
  const [rejectState, rejectAction] = useActionState(rejectImportAction, initialState);
  const [retryState, retryAction] = useActionState(retryImportParseAction, initialState);
  const router = useRouter();
  const canConfirm = status === "PENDING_REVIEW";
  const canRetry = status === "PENDING_REVIEW" || status === "FAILED" || status === "SKIPPED";
  const canReject = status === "PENDING_REVIEW" || status === "FAILED" || status === "SKIPPED";
  const visibleState = [confirmState, retryState, rejectState].find((state) => state.status !== "idle") ?? initialState;

  useEffect(() => {
    if (confirmState.status === "success" || rejectState.status === "success" || retryState.status === "success") {
      router.refresh();
    }
  }, [confirmState.status, rejectState.status, retryState.status, confirmState.timestamp, rejectState.timestamp, retryState.timestamp, router]);

  if (!canConfirm && !canRetry && !canReject) {
    return null;
  }

  return (
    <div className="review-actions">
      {canConfirm ? (
        <form action={confirmAction}>
          <input type="hidden" name="batchId" value={batchId} />
          <Button kind="confirm">Confirm import</Button>
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
      <ActionStatus state={visibleState} />
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
    <form className="category-form" action={action}>
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="transactionIndex" value={transactionIndex} />
      <CategorySelect category={category} label="Import preview category" />
      <CategorySaveButton />
      {state.status !== "idle" ? <ActionStatus state={state} /> : null}
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
    <form className="category-form" action={action}>
      <input type="hidden" name="transactionId" value={transactionId} />
      <CategorySelect category={category} label="Transaction category" />
      <CategorySaveButton />
      {state.status !== "idle" ? <ActionStatus state={state} /> : null}
    </form>
  );
}
