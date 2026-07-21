"use client";

import { useMemo, useState } from "react";
import { Brain, Search, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SectionCard, StatusChip, type ChipTone } from "./ui";

export type MemoryObservation = { id: string; topic: string; content: string; priority: string; tone: ChipTone; dateLabel: string };
export type MemoryReflection = { id: string; title: string; summary: string; dateLabel: string };

const itemClass = "-mx-2 grid gap-1 rounded-md px-2 py-2 transition-colors hover:bg-secondary";
const headClass = "flex flex-wrap items-center gap-2";
const bodyClass = "text-[0.84rem] leading-[1.5] text-muted-foreground";
const dateClass = "ml-auto text-[0.72rem] text-muted-foreground";

export function MemoryPanels({ observations, reflections }: { observations: MemoryObservation[]; reflections: MemoryReflection[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filteredObservations = useMemo(
    () => (q ? observations.filter((o) => `${o.topic} ${o.content} ${o.priority}`.toLowerCase().includes(q)) : observations),
    [observations, q]
  );
  const filteredReflections = useMemo(
    () => (q ? reflections.filter((r) => `${r.title} ${r.summary}`.toLowerCase().includes(q)) : reflections),
    [reflections, q]
  );

  return (
    <section className="grid gap-[18px]">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          className="pl-8"
          type="search"
          placeholder="Filter observations and reflections…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Filter memory"
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)] gap-[18px] max-[1160px]:grid-cols-1">
        <SectionCard title="Observations" sub={`${filteredObservations.length} shown · ${observations.length} loaded`} action={<Brain size={18} aria-hidden="true" />}>
          <div className="grid gap-1">
            {filteredObservations.map((observation) => (
              <article className={itemClass} key={observation.id}>
                <div className={headClass}>
                  <StatusChip tone={observation.tone} label={observation.priority.toLowerCase()} />
                  <strong className="text-[0.86rem] font-semibold">{observation.topic}</strong>
                  <span className={dateClass}>{observation.dateLabel}</span>
                </div>
                <p className={bodyClass}>{observation.content}</p>
              </article>
            ))}
            {filteredObservations.length === 0 ? (
              <p className="text-[0.86rem] text-muted-foreground">{q ? "No observations match your filter." : "No observations yet."}</p>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard title="Reflections" sub={`${filteredReflections.length} shown · ${reflections.length} loaded`} action={<Sparkles size={18} aria-hidden="true" />}>
          <div className="grid gap-1">
            {filteredReflections.map((reflection) => (
              <article className={itemClass} key={reflection.id}>
                <div className={headClass}>
                  <strong className="text-[0.86rem] font-semibold [overflow-wrap:anywhere]">{reflection.title}</strong>
                  <span className={dateClass}>{reflection.dateLabel}</span>
                </div>
                <p className={bodyClass}>{reflection.summary}</p>
              </article>
            ))}
            {filteredReflections.length === 0 ? (
              <p className="text-[0.86rem] text-muted-foreground">{q ? "No reflections match your filter." : "No reflections yet."}</p>
            ) : null}
          </div>
        </SectionCard>
      </div>
    </section>
  );
}
