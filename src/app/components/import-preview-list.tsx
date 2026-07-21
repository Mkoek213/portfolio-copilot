"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { bulkUpdateImportPreviewReviewAction, type ActionResult } from "../actions";
import { ActionStatus } from "./action-status";
import { ImportPreviewCategoryControl, ImportPreviewReviewControl } from "./import-controls";

const initialState: ActionResult = { status: "idle", message: "" };

export type PreviewItem = { transactionIndex: number; description: string; amount: number; currency: string; category: string };

function BulkButton({ status, count, label }: { status: "ACCEPTED" | "REJECTED"; count: number; label: string }) {
  const { pending } = useFormStatus();
  const Icon = pending ? Loader2 : status === "ACCEPTED" ? Check : X;

  return (
    <Button variant={status === "REJECTED" ? "destructive-outline" : "outline"} size="sm" type="submit" name="reviewStatus" value={status} disabled={pending || count === 0} aria-busy={pending}>
      <Icon className={pending ? "animate-spin" : undefined} size={14} aria-hidden="true" />
      {label} {count}
    </Button>
  );
}

export function ImportPreviewList({
  batchId,
  items,
  acceptedCount,
  rejectedCount
}: {
  batchId: string;
  items: PreviewItem[];
  acceptedCount: number;
  rejectedCount: number;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkState, bulkAction] = useActionState(bulkUpdateImportPreviewReviewAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (bulkState.status === "success") {
      setSelected(new Set());
      router.refresh();
    }
  }, [router, bulkState.status, bulkState.timestamp]);

  const allSelected = items.length > 0 && selected.size === items.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((item) => item.transactionIndex)));
  const toggle = (index: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });

  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center gap-2.5 text-[0.78rem] text-muted-foreground">
        <label className="flex cursor-pointer items-center gap-1.5">
          <Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={toggleAll} aria-label="Select all pending transactions" />
          Select all
        </label>
        <strong className="font-[650] text-warn">{items.length} pending</strong>
        <span>{acceptedCount} accepted</span>
        <span>{rejectedCount} rejected</span>
        {selected.size > 0 ? (
          <form action={bulkAction} className="ml-auto flex gap-1">
            <input type="hidden" name="batchId" value={batchId} />
            {[...selected].map((index) => (
              <input key={index} type="hidden" name="transactionIndex" value={index} />
            ))}
            <BulkButton status="ACCEPTED" count={selected.size} label="Accept" />
            <BulkButton status="REJECTED" count={selected.size} label="Reject" />
          </form>
        ) : null}
      </div>

      <div
        className="grid max-h-[min(62vh,680px)] gap-2 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]"
        tabIndex={0}
        aria-label={`Import transactions: ${items.length} pending, ${acceptedCount} accepted, ${rejectedCount} rejected`}
      >
        {items.map((item) => (
          <div
            className="grid grid-cols-[auto_minmax(150px,0.6fr)_auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md border border-transparent bg-secondary px-2.5 py-2 max-[640px]:grid-cols-[auto_minmax(0,1fr)_auto]"
            key={item.transactionIndex}
          >
            <Checkbox
              checked={selected.has(item.transactionIndex)}
              onCheckedChange={() => toggle(item.transactionIndex)}
              aria-label={`Select ${item.description}`}
            />
            <div className="max-[640px]:col-span-full">
              <ImportPreviewCategoryControl batchId={batchId} transactionIndex={item.transactionIndex} category={item.category} />
            </div>
            <ImportPreviewReviewControl batchId={batchId} transactionIndex={item.transactionIndex} />
            <strong className="text-[0.84rem] font-medium [overflow-wrap:anywhere]">{item.description}</strong>
            <span className="whitespace-nowrap text-[0.84rem] font-semibold tabular-nums">{formatMoney(item.amount, item.currency)}</span>
          </div>
        ))}
        {items.length === 0 ? <p className="text-[0.86rem] text-muted-foreground">All transactions reviewed.</p> : null}
      </div>

      {bulkState.status === "error" ? <ActionStatus state={bulkState} /> : null}
    </div>
  );
}
