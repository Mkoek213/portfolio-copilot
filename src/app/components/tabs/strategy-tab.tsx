import type { DashboardData } from "../../dashboard-data";
import { StrategySettingsForm } from "../strategy-settings-form";
import { SectionCard, StatusChip, type ChipTone } from "../ui";

function suggestionTone(status: string): ChipTone {
  switch (status) {
    case "accepted":
      return "good";
    case "rejected":
      return "muted";
    default:
      return "info";
  }
}

export function StrategyTab({ data }: { data: DashboardData }) {
  return (
    <section className="grid grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)] gap-[18px] max-[1160px]:grid-cols-1">
      <StrategySettingsForm strategy={data.strategy} />
      <SectionCard title="Strategy suggestions" sub={`${data.suggestions.length} latest`}>
        <div className="grid gap-1">
          {data.suggestions.map((suggestion) => (
            <article className="-mx-2 grid gap-1 rounded-md px-2 py-2 transition-colors hover:bg-secondary" key={suggestion.id}>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip tone={suggestionTone(suggestion.status)} label={suggestion.status} />
                <strong className="text-[0.86rem] font-semibold [overflow-wrap:anywhere]">{suggestion.title}</strong>
              </div>
              <p className="text-[0.84rem] leading-[1.5] text-muted-foreground">{suggestion.rationale}</p>
            </article>
          ))}
          {data.suggestions.length === 0 ? <p className="text-[0.86rem] text-muted-foreground">No strategy suggestions yet.</p> : null}
        </div>
      </SectionCard>
    </section>
  );
}
