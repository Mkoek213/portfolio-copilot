"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { ActionResult } from "../actions";

export function ActionStatus({ state }: { state: ActionResult }) {
  if (state.status === "idle") {
    return null;
  }

  const isSuccess = state.status === "success";

  return (
    <div className={`action-status ${isSuccess ? "success" : "error"}`} role="status" aria-live="polite">
      {isSuccess ? <CheckCircle2 size={18} aria-hidden="true" /> : <AlertCircle size={18} aria-hidden="true" />}
      <div>
        <strong>{state.message}</strong>
        {state.detail ? <span>{state.detail}</span> : null}
      </div>
    </div>
  );
}
