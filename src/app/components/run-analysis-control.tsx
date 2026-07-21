"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runAnalysisAction, type ActionResult } from "../actions";
import { ActionStatus } from "./action-status";
import type { LocalLlmHealth } from "@/lib/llm/local-llm-client";
import type { LocalLlmModelPreset } from "@/lib/llm/model-presets";

const initialState: ActionResult = {
  status: "idle",
  message: ""
};

function RunButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
      {pending ? "Running…" : "Run analysis"}
    </Button>
  );
}

export function RunAnalysisControl({
  modelPresets,
  defaultModel,
  localLlmHealth
}: {
  modelPresets: LocalLlmModelPreset[];
  defaultModel: string;
  localLlmHealth: LocalLlmHealth;
}) {
  const [state, formAction] = useActionState(runAnalysisAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status, state.timestamp]);

  return (
    <div className="grid justify-items-end gap-2 max-[920px]:w-full max-[920px]:justify-items-stretch">
      <form action={formAction} className="flex gap-2 max-[920px]:flex-wrap">
        <label className="max-[920px]:w-full" aria-label="Local model">
          <select
            name="llmModel"
            defaultValue={defaultModel}
            title={localLlmHealth.available ? `Ollama available · ${localLlmHealth.model}` : localLlmHealth.reason}
            className="h-8 min-w-[210px] rounded-lg border border-input bg-background px-2.5 text-[0.84rem] text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 max-[920px]:w-full max-[920px]:min-w-0"
          >
            {modelPresets.map((preset) => (
              <option key={preset.key} value={preset.model}>
                {preset.label} · {preset.model}
              </option>
            ))}
          </select>
        </label>
        <RunButton />
      </form>
      <ActionStatus state={state} />
    </div>
  );
}
