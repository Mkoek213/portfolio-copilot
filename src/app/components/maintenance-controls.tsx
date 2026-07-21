"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Clock3, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cleanupRetentionAction, runSchedulerNowAction, type ActionResult } from "../actions";
import { ActionStatus } from "./action-status";

const initialState: ActionResult = { status: "idle", message: "" };

function MaintenanceButton({ kind, children }: { kind: "scheduler" | "cleanup"; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  const Icon = pending ? Loader2 : kind === "scheduler" ? Clock3 : Trash2;

  return (
    <Button variant={kind === "cleanup" ? "destructive-outline" : "outline"} size="sm" type="submit" disabled={pending} aria-busy={pending}>
      <Icon className={pending ? "animate-spin" : undefined} size={16} aria-hidden="true" />
      {children}
    </Button>
  );
}

export function SchedulerNowControl() {
  const [state, action] = useActionState(runSchedulerNowAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status, state.timestamp]);

  return (
    <div className="my-1 grid justify-items-start gap-2.5">
      <form action={action}>
        <MaintenanceButton kind="scheduler">Run scheduler tick</MaintenanceButton>
      </form>
      <ActionStatus state={state} />
    </div>
  );
}

export function RetentionCleanupControl() {
  const [state, action] = useActionState(cleanupRetentionAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status, state.timestamp]);

  return (
    <div className="my-1 grid justify-items-start gap-2.5">
      <form action={action}>
        <MaintenanceButton kind="cleanup">Clean retained data</MaintenanceButton>
      </form>
      <ActionStatus state={state} />
    </div>
  );
}
