"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, Loader2, RotateCcw, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateSuggestionStatusAction, type ActionResult } from "../actions";
import { ActionStatus } from "./action-status";

const initialState: ActionResult = { status: "idle", message: "" };

function StatusButton({
  status,
  icon: Icon,
  label,
  variant,
  className
}: {
  status: string;
  icon: LucideIcon;
  label: string;
  variant: "outline" | "destructive-outline";
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button variant={variant} size="icon-sm" type="submit" name="status" value={status} disabled={pending} aria-busy={pending} aria-label={label} title={label} className={className}>
      {pending ? <Loader2 className="animate-spin" size={14} aria-hidden="true" /> : <Icon size={14} aria-hidden="true" />}
    </Button>
  );
}

export function StrategySuggestionControl({ suggestionId, status }: { suggestionId: string; status: string }) {
  const [state, action] = useActionState(updateSuggestionStatusAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status, state.timestamp]);

  return (
    <div className="grid gap-1.5">
      <form action={action} className="flex gap-1">
        <input type="hidden" name="suggestionId" value={suggestionId} />
        {status !== "accepted" ? (
          <StatusButton status="accepted" icon={Check} label="Accept suggestion" variant="outline" className="text-muted-foreground hover:border-good/40 hover:bg-good-soft hover:text-good" />
        ) : null}
        {status !== "rejected" ? <StatusButton status="rejected" icon={X} label="Reject suggestion" variant="destructive-outline" /> : null}
        {status !== "pending" ? (
          <StatusButton status="pending" icon={RotateCcw} label="Reset to pending" variant="outline" className="text-muted-foreground" />
        ) : null}
      </form>
      {state.status === "error" ? <ActionStatus state={state} /> : null}
    </div>
  );
}
