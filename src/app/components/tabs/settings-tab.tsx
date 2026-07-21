import { formatDateTime } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { DashboardData } from "../../dashboard-data";
import { RetentionCleanupControl } from "../maintenance-controls";
import { FactGrid, FactRow, SectionCard, StatusChip } from "../ui";

const thClass = "text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted-foreground";

export function SettingsTab({ data }: { data: DashboardData }) {
  return (
    <section className="grid gap-[18px]">
      <div className="grid grid-cols-2 gap-[18px] max-[1160px]:grid-cols-1">
        <SectionCard title="Local services" sub="No external LLM providers are ever used">
          <FactGrid>
            <FactRow label="Ollama">
              <StatusChip tone={data.localLlmHealth.available ? "good" : "warn"} label={data.localLlmHealth.available ? "available" : "unavailable"} />
            </FactRow>
            <FactRow label="Model"><strong className="font-semibold">{data.localLlmHealth.model}</strong></FactRow>
            <FactRow label="Gmail">
              <StatusChip tone={data.gmailHealth.available ? "good" : data.gmailHealth.enabled ? "warn" : "muted"} label={data.gmailHealth.enabled ? (data.gmailHealth.available ? "available" : "unavailable") : "disabled"} />
            </FactRow>
            <FactRow label="Langfuse">
              <StatusChip tone={data.langfuseStatus.available ? "good" : "muted"} label={data.langfuseStatus.available ? "available" : "off"} />
            </FactRow>
          </FactGrid>
          <p className="mt-3 text-[0.8rem] leading-[1.5] text-muted-foreground [overflow-wrap:anywhere]">{data.gmailHealth.reason} · {data.langfuseStatus.reason}</p>
        </SectionCard>
        <SectionCard title="Retention" sub="Reports, runs, events and trace spans are kept for about 3 months">
          <RetentionCleanupControl />
        </SectionCard>
      </div>
      <SectionCard title="Trace spans" sub={`${data.traceSpans.length} latest · ${data.runCount} runs total`} contentClassName="px-0">
        {data.traceSpans.length > 0 ? (
          <Table className="min-w-[520px]">
            <TableHeader>
              <TableRow>
                <TableHead className={cn("pl-5", thClass)}>Span</TableHead>
                <TableHead className={thClass}>Status</TableHead>
                <TableHead className={thClass}>Level</TableHead>
                <TableHead className={cn("pr-5 text-right", thClass)}>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.traceSpans.map((span) => (
                <TableRow key={span.id}>
                  <TableCell className="whitespace-normal py-2.5 pl-5 align-top">
                    <strong className="font-semibold">{span.name}</strong>
                    <span className="mt-0.5 block text-[0.78rem] text-muted-foreground [overflow-wrap:anywhere]">trace {span.traceId.slice(-10)}</span>
                  </TableCell>
                  <TableCell className="py-2.5 align-top">
                    <StatusChip
                      tone={span.status === "OK" ? "good" : span.status === "ERROR" ? "crit" : span.status === "WARN" ? "warn" : "info"}
                      label={span.status.toLowerCase()}
                    />
                  </TableCell>
                  <TableCell className="py-2.5 align-top text-muted-foreground">{span.level.toLowerCase()}</TableCell>
                  <TableCell className="whitespace-nowrap py-2.5 pr-5 text-right align-top tabular-nums text-muted-foreground">{formatDateTime(span.startedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="px-5 text-[0.86rem] text-muted-foreground">No trace spans yet.</p>
        )}
      </SectionCard>
    </section>
  );
}
