import { DEFAULT_LOCAL_LLM_MODEL } from "./model-presets";

export type LocalLlmChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LocalLlmErrorCode =
  | "invalid_endpoint"
  | "network_error"
  | "timeout"
  | "http_error"
  | "invalid_response";

export type LocalLlmResult =
  | {
      success: true;
      content: string;
      model: string;
    }
  | {
      success: false;
      error: {
        code: LocalLlmErrorCode;
        message: string;
      };
    };

export type LocalLlmHealth = {
  provider: "ollama";
  enabled: boolean;
  available: boolean;
  baseUrl: string;
  model: string;
  installedModels: string[];
  reason: string;
};

type LocalLlmClientOptions = {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  allowLan?: boolean;
  numPredict?: number;
  temperature?: number;
};

type OllamaChatResponse = {
  message?: {
    content?: unknown;
  };
  model?: unknown;
};

type OllamaTagsResponse = {
  models?: Array<{
    name?: unknown;
    model?: unknown;
  }>;
};

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_TIMEOUT_MS = 60_000;
const HEALTH_TIMEOUT_MS = 1_500;

function envFlag(value: string | undefined, defaultValue = false) {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function envTimeoutMs(value: string | undefined) {
  if (value === undefined || value === "") {
    return DEFAULT_TIMEOUT_MS;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

export function getLocalLlmConfig(overrides: LocalLlmClientOptions = {}) {
  return {
    baseUrl: overrides.baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL,
    model: overrides.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_LOCAL_LLM_MODEL,
    timeoutMs: overrides.timeoutMs ?? envTimeoutMs(process.env.LLM_TIMEOUT_MS),
    allowLan: overrides.allowLan ?? envFlag(process.env.OLLAMA_ALLOW_LAN),
    numPredict: overrides.numPredict,
    temperature: overrides.temperature
  };
}

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function isPrivateLanHostname(hostname: string) {
  if (hostname.endsWith(".local")) {
    return true;
  }

  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function validateLocalLlmEndpoint(baseUrl: string, allowLan = false) {
  try {
    const parsed = new URL(baseUrl);
    const protocolAllowed = parsed.protocol === "http:" || parsed.protocol === "https:";
    const hostname = parsed.hostname;
    const hostAllowed = isLocalHostname(hostname) || (allowLan && isPrivateLanHostname(hostname));

    if (!protocolAllowed || !hostAllowed) {
      return {
        success: false as const,
        message: allowLan
          ? "Ollama endpoint must be localhost, loopback or a private LAN host."
          : "Ollama endpoint must be localhost or loopback by default."
      };
    }

    return { success: true as const, url: parsed };
  } catch {
    return { success: false as const, message: "Ollama endpoint URL is invalid." };
  }
}

function errorResult(code: LocalLlmErrorCode, message: string): LocalLlmResult {
  return {
    success: false,
    error: {
      code,
      message
    }
  };
}

async function fetchWithTimeout(url: URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function chatWithLocalLlm(
  messages: LocalLlmChatMessage[],
  options: LocalLlmClientOptions = {}
): Promise<LocalLlmResult> {
  const config = getLocalLlmConfig(options);
  const endpoint = validateLocalLlmEndpoint(config.baseUrl, config.allowLan);

  if (!endpoint.success) {
    return errorResult("invalid_endpoint", endpoint.message);
  }

  const url = new URL("/api/chat", endpoint.url);

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: false,
          options: {
            ...(config.numPredict ? { num_predict: config.numPredict } : {}),
            ...(config.temperature !== undefined ? { temperature: config.temperature } : {})
          }
        })
      },
      config.timeoutMs
    );

    if (!response.ok) {
      return errorResult("http_error", `Ollama returned HTTP ${response.status}.`);
    }

    const json = (await response.json()) as OllamaChatResponse;
    const content = json.message?.content;

    if (typeof content !== "string" || content.trim().length === 0) {
      return errorResult("invalid_response", "Ollama response did not contain a non-empty message.");
    }

    return {
      success: true,
      content: content.trim(),
      model: typeof json.model === "string" ? json.model : config.model
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return errorResult("timeout", `Ollama request timed out after ${config.timeoutMs} ms.`);
    }

    return errorResult("network_error", error instanceof Error ? error.message : "Could not reach local Ollama.");
  }
}

export async function checkLocalLlmHealth(options: LocalLlmClientOptions = {}): Promise<LocalLlmHealth> {
  const config = getLocalLlmConfig({
    ...options,
    timeoutMs: options.timeoutMs ?? HEALTH_TIMEOUT_MS
  });
  const endpoint = validateLocalLlmEndpoint(config.baseUrl, config.allowLan);

  if (!endpoint.success) {
    return {
      provider: "ollama",
      enabled: envFlag(process.env.LLM_REPORTER_ENABLED),
      available: false,
      baseUrl: config.baseUrl,
      model: config.model,
      installedModels: [],
      reason: endpoint.message
    };
  }

  try {
    const response = await fetchWithTimeout(new URL("/api/tags", endpoint.url), { method: "GET" }, config.timeoutMs);

    if (!response.ok) {
      return {
        provider: "ollama",
        enabled: envFlag(process.env.LLM_REPORTER_ENABLED),
        available: false,
        baseUrl: config.baseUrl,
        model: config.model,
        installedModels: [],
        reason: `Ollama tags returned HTTP ${response.status}.`
      };
    }

    const json = (await response.json()) as OllamaTagsResponse;
    const installedModels =
      json.models?.flatMap((item) => {
        const name = typeof item.name === "string" ? item.name : undefined;
        const model = typeof item.model === "string" ? item.model : undefined;
        return [name, model].filter((value): value is string => Boolean(value));
      }) ?? [];
    const available = installedModels.includes(config.model);

    return {
      provider: "ollama",
      enabled: envFlag(process.env.LLM_REPORTER_ENABLED),
      available,
      baseUrl: config.baseUrl,
      model: config.model,
      installedModels,
      reason: available ? "local Gemma available" : "Ollama is running, but the selected model is not installed."
    };
  } catch (error) {
    const timeout = error instanceof Error && error.name === "AbortError";

    return {
      provider: "ollama",
      enabled: envFlag(process.env.LLM_REPORTER_ENABLED),
      available: false,
      baseUrl: config.baseUrl,
      model: config.model,
      installedModels: [],
      reason: timeout ? `Ollama health check timed out after ${config.timeoutMs} ms.` : "Ollama is unavailable."
    };
  }
}

export function isLocalLlmReporterEnabled() {
  return process.env.LLM_PROVIDER === "ollama" && envFlag(process.env.LLM_REPORTER_ENABLED);
}
