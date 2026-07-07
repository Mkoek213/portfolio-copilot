import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, MinusCircle } from "lucide-react";

export type ChipTone = "good" | "warn" | "serious" | "crit" | "info" | "muted";

const CHIP_ICONS = {
  good: CheckCircle2,
  warn: AlertTriangle,
  serious: AlertTriangle,
  crit: AlertCircle,
  info: Info,
  muted: MinusCircle
} as const;

export function StatusChip({ tone, label }: { tone: ChipTone; label: string }) {
  const Icon = CHIP_ICONS[tone];

  return (
    <span className={`chip chip-${tone}`}>
      <Icon size={13} aria-hidden="true" />
      {label}
    </span>
  );
}

export function riskTone(level: string): ChipTone {
  switch (level.toLowerCase()) {
    case "critical":
    case "error":
      return "crit";
    case "warning":
    case "warn":
      return "warn";
    default:
      return "info";
  }
}

export function importStatusTone(status: string): ChipTone {
  switch (status) {
    case "IMPORTED":
      return "good";
    case "PENDING_REVIEW":
      return "warn";
    case "FAILED":
      return "crit";
    default:
      return "muted";
  }
}

export function runStatusTone(status: string): ChipTone {
  switch (status) {
    case "COMPLETED":
      return "good";
    case "FAILED":
      return "crit";
    case "NEEDS_REVIEW":
      return "warn";
    default:
      return "info";
  }
}

export function StatTile({
  label,
  value,
  delta,
  hint,
  children
}: {
  label: string;
  value: string | number;
  delta?: { text: string; good: boolean };
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <strong className="tile-value">{value}</strong>
      <div className="tile-foot">
        {delta ? <span className={delta.good ? "tile-delta delta-good" : "tile-delta delta-bad"}>{delta.text}</span> : null}
        {hint ? <span className="tile-hint">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function PanelHeading({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        {sub ? <span>{sub}</span> : null}
      </div>
      {action ?? null}
    </div>
  );
}
