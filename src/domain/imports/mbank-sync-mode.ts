import type { MbankSyncMode } from "@prisma/client";

export const MBANK_SYNC_MODE_OPTIONS: Array<{ value: MbankSyncMode; label: string }> = [
  { value: "BOTH", label: "Daily notifications + monthly statements" },
  { value: "STATEMENT_ONLY", label: "Monthly statements only" },
  { value: "DAILY_ONLY", label: "Daily notifications only" }
];

export function mbankSyncModeLabel(syncMode: MbankSyncMode) {
  return MBANK_SYNC_MODE_OPTIONS.find((option) => option.value === syncMode)?.label ?? syncMode;
}
