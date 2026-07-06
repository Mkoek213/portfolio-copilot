"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";
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
    <button className="primary-button" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
      {pending ? "Running…" : "Run analysis"}
    </button>
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
    <div className="run-control">
      <form action={formAction} className="run-form">
        <label className="run-model" aria-label="Local model">
          <select name="llmModel" defaultValue={defaultModel} title={localLlmHealth.available ? `Ollama available · ${localLlmHealth.model}` : localLlmHealth.reason}>
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
