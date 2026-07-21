"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ActionResult } from "../actions";

export function ActionStatus({ state }: { state: ActionResult }) {
  if (state.status === "idle") {
    return null;
  }

  const isSuccess = state.status === "success";

  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}>
      <Alert
        role={isSuccess ? "status" : "alert"}
        aria-live={isSuccess ? "polite" : "assertive"}
        className={cn("max-w-[420px] border-transparent", isSuccess ? "bg-good-soft text-good" : "bg-crit-soft text-crit")}
      >
        {isSuccess ? <CheckCircle2 aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
        <AlertTitle className="font-semibold">{state.message}</AlertTitle>
        {state.detail ? <AlertDescription className="text-current opacity-85">{state.detail}</AlertDescription> : null}
      </Alert>
    </motion.div>
  );
}
