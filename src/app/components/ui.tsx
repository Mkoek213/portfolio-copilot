import type { ComponentProps, ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { VariantProps } from "class-variance-authority";

export type ChipTone = "good" | "warn" | "serious" | "crit" | "info" | "muted";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

const CHIP_ICONS = {
  good: CheckCircle2,
  warn: AlertTriangle,
  serious: AlertTriangle,
  crit: AlertCircle,
  info: Info,
  muted: MinusCircle
} as const;

// "serious" reuses the warn tone, matching the legacy `.chip-serious` styling.
const CHIP_VARIANT: Record<ChipTone, BadgeVariant> = {
  good: "good",
  warn: "warn",
  serious: "warn",
  crit: "crit",
  info: "info",
  muted: "muted"
};

export function StatusChip({ tone, label }: { tone: ChipTone; label: string }) {
  const Icon = CHIP_ICONS[tone];

  return (
    <Badge variant={CHIP_VARIANT[tone]}>
      <Icon size={13} aria-hidden="true" />
      {label}
    </Badge>
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
    <Card className="relative min-h-[106px] justify-start gap-1.5 px-[17px] py-[15px] shadow-card transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-[3px] hover:shadow-[0_10px_26px_rgba(22,24,21,0.10)] dark:hover:shadow-[0_10px_28px_rgba(0,0,0,0.45)]">
      <span className="text-[0.78rem] font-medium text-muted-foreground">{label}</span>
      <strong className="text-[1.5rem] font-[650] leading-[1.15] tracking-[-0.015em]">{value}</strong>
      <div className="flex max-w-[calc(100%-108px)] flex-wrap items-baseline gap-2">
        {delta ? <span className={cn("text-[0.76rem] font-[650]", delta.good ? "text-good" : "text-crit")}>{delta.text}</span> : null}
        {hint ? <span className="text-[0.76rem] text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </Card>
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

/**
 * Formalizes the legacy `.fact-grid` pattern (settings, imports scheduler): a
 * responsive two-column grid of labelled value boxes.
 */
export function FactGrid({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid grid-cols-2 gap-2.5 max-[640px]:grid-cols-2", className)} {...props} />;
}

export function FactRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-16 min-w-0 content-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-2.5">
      <span className="text-[0.72rem] font-medium text-muted-foreground">{label}</span>
      <div className="justify-self-start text-[0.88rem] [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}
