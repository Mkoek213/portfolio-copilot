export type LangfuseLocalStatus = {
  enabled: boolean;
  available: boolean;
  baseUrl: string;
  reason: string;
};

const DEFAULT_LANGFUSE_BASE_URL = "http://localhost:3005";

function envFlag(value: string | undefined, defaultValue = false) {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function validateLocalUrl(baseUrl: string) {
  try {
    const parsed = new URL(baseUrl);
    const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
    return parsed.protocol.startsWith("http") && local ? { success: true as const, url: parsed } : { success: false as const };
  } catch {
    return { success: false as const };
  }
}

export async function checkLocalLangfuseStatus(): Promise<LangfuseLocalStatus> {
  const enabled = envFlag(process.env.LANGFUSE_ENABLED);
  const baseUrl = process.env.LANGFUSE_BASE_URL || DEFAULT_LANGFUSE_BASE_URL;
  const endpoint = validateLocalUrl(baseUrl);

  if (!enabled) {
    return { enabled, available: false, baseUrl, reason: "Langfuse disabled in local env." };
  }

  if (!endpoint.success) {
    return { enabled, available: false, baseUrl, reason: "Langfuse base URL must be local." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);

  try {
    const response = await fetch(new URL("/api/public/health", endpoint.url), { signal: controller.signal });
    return {
      enabled,
      available: response.ok,
      baseUrl,
      reason: response.ok ? "Local Langfuse health check passed." : `Langfuse returned HTTP ${response.status}.`
    };
  } catch {
    return { enabled, available: false, baseUrl, reason: "Local Langfuse unavailable." };
  } finally {
    clearTimeout(timeout);
  }
}
