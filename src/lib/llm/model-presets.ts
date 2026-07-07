export type LocalLlmModelPreset = {
  key: string;
  label: string;
  model: string;
  target: string;
};

export const LOCAL_LLM_MODEL_PRESETS: LocalLlmModelPreset[] = [
  {
    key: "phone-light",
    label: "Phone/light",
    model: "gemma3:1b",
    target: "Smallest preset for constrained local runtimes."
  },
  {
    key: "laptop-balanced",
    label: "Laptop balanced",
    model: "gemma3:4b",
    target: "Default preset for the current laptop."
  },
  {
    key: "pc-16gb",
    label: "PC 16GB VRAM",
    model: "gemma3:12b",
    target: "Largest practical preset before trying 27B-class models."
  }
];

export const DEFAULT_LOCAL_LLM_MODEL = "gemma3:4b";

export function resolveAllowedLocalLlmModel(value: FormDataEntryValue | string | null | undefined): string {
  const model = typeof value === "string" ? value.trim() : "";

  if (LOCAL_LLM_MODEL_PRESETS.some((preset) => preset.model === model)) {
    return model;
  }

  return process.env.OLLAMA_MODEL?.trim() || DEFAULT_LOCAL_LLM_MODEL;
}
