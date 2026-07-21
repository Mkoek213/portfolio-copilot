import { formatDate } from "@/lib/format";
import type { DashboardData } from "../../dashboard-data";
import { MemoryPanels } from "../memory-panels";
import { type ChipTone } from "../ui";

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

/** Derive a meaningful heading from a reflection's summary (no topic column). */
function reflectionTitle(summary: string): string {
  const firstLine = summary.split(/\n/)[0]?.trim() ?? "";
  const firstSentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine;
  const trimmed = firstSentence.length > 72 ? `${firstSentence.slice(0, 72).trimEnd()}…` : firstSentence;
  return trimmed || "Reflection";
}

export function MemoryTab({ data }: { data: DashboardData }) {
  const observations = data.observations.map((observation) => ({
    id: observation.id,
    topic: observation.topic,
    content: observation.content,
    priority: observation.priority,
    tone: priorityTone(observation.priority),
    dateLabel: formatDate(observation.createdAt)
  }));

  const reflections = data.reflections.map((reflection) => ({
    id: reflection.id,
    title: reflectionTitle(reflection.summary),
    summary: reflection.summary,
    dateLabel: formatDate(reflection.createdAt)
  }));

  return <MemoryPanels observations={observations} reflections={reflections} />;
}
