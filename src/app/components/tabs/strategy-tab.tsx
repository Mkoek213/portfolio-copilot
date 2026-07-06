import type { DashboardData } from "../../dashboard-data";
import { StrategySettingsForm } from "../strategy-settings-form";
import { PanelHeading, StatusChip, type ChipTone } from "../ui";

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
    <section className="grid-2 grid-major">
      <StrategySettingsForm strategy={data.strategy} />
      <div className="panel">
        <PanelHeading title="Strategy suggestions" sub={`${data.suggestions.length} latest`} />
        <div className="memory-list">
          {data.suggestions.map((suggestion) => (
            <article key={suggestion.id}>
              <div className="memory-head">
                <StatusChip tone={suggestionTone(suggestion.status)} label={suggestion.status} />
                <strong>{suggestion.title}</strong>
              </div>
              <p>{suggestion.rationale}</p>
            </article>
          ))}
          {data.suggestions.length === 0 ? <p className="empty-state">No strategy suggestions yet.</p> : null}
        </div>
      </div>
    </section>
  );
}
