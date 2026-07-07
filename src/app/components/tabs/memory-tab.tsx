import { formatDate } from "@/lib/format";
import type { DashboardData } from "../../dashboard-data";
import { PanelHeading, StatusChip, type ChipTone } from "../ui";

function priorityTone(priority: string): ChipTone {
  switch (priority) {
    case "HIGH":
      return "crit";
    case "MEDIUM":
      return "warn";
    case "COMPLETED":
      return "good";
    default:
      return "muted";
  }
}

export function MemoryTab({ data }: { data: DashboardData }) {
  return (
    <section className="grid-2 grid-major">
      <div className="panel">
        <PanelHeading title="Observations" sub={`${data.observations.length} latest · ${data.observationCount} total`} />
        <div className="memory-list">
          {data.observations.map((observation) => (
            <article key={observation.id}>
              <div className="memory-head">
                <StatusChip tone={priorityTone(observation.priority)} label={observation.priority.toLowerCase()} />
                <strong>{observation.topic}</strong>
                <span className="cell-faint">{formatDate(observation.createdAt)}</span>
              </div>
              <p>{observation.content}</p>
            </article>
          ))}
          {data.observations.length === 0 ? <p className="empty-state">No observations yet.</p> : null}
        </div>
      </div>
      <div className="panel">
        <PanelHeading title="Reflections" sub={`${data.reflections.length} latest`} />
        <div className="memory-list">
          {data.reflections.map((reflection) => (
            <article key={reflection.id}>
              <div className="memory-head">
                <strong>Reflection</strong>
                <span className="cell-faint">{formatDate(reflection.createdAt)}</span>
              </div>
              <p>{reflection.summary}</p>
            </article>
          ))}
          {data.reflections.length === 0 ? <p className="empty-state">No reflections yet.</p> : null}
        </div>
      </div>
    </section>
  );
}
