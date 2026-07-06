export type GmailMcpProvider = "local" | "google-official" | "gmail-api";

export type GmailMcpHealth = {
  enabled: boolean;
  available: boolean;
  provider: GmailMcpProvider;
  baseUrl: string;
  reason: string;
};

export type GmailMessageSummary = {
  id: string;
  threadId?: string | null;
  subject?: string | null;
  sender?: string | null;
  receivedAt?: Date | null;
  snippet?: string | null;
};

export type GmailMessageBody = GmailMessageSummary & {
  bodyText: string;
};

type GmailMcpConfig = {
  enabled: boolean;
  provider: GmailMcpProvider;
  baseUrl: string;
  query: string;
  dailyLookbackDays: number;
  maxMessages: number;
  timeoutMs: number;
  accessToken: string;
  refreshToken: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthTokenUrl: string;
  healthTool: string;
  searchTool: string;
  readTool: string;
};

type CachedOAuthToken = {
  accessToken: string;
  expiresAt: number;
};

const LOCAL_BASE_URL = "http://127.0.0.1:3005/mcp";
const GOOGLE_OFFICIAL_BASE_URL = "https://gmailmcp.googleapis.com/mcp/v1";
const GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_QUERY = "from:(mbank) newer_than:3d";
const DEFAULT_MAX_MESSAGES = 1;
const DEFAULT_TIMEOUT_MS = 5_000;

let cachedOAuthToken: CachedOAuthToken | null = null;

export const READ_ONLY_GMAIL_TOOLS = new Set([
  "gmail.profile",
  "gmail.search",
  "gmail.read",
  "get_profile",
  "search_messages",
  "read_message",
  "gmail_get_profile",
  "gmail_search_messages",
  "gmail_read_message",
  "list_labels",
  "search_threads",
  "get_thread",
  "gmail.list_labels",
  "gmail.search_threads",
  "gmail.get_thread",
  "users.profile.get",
  "users.messages.list",
  "users.messages.get"
]);

function envFlag(value: string | undefined, defaultValue = false) {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function normalizeProvider(value: string | undefined): GmailMcpProvider {
  if (value === "google-official" || value === "local") {
    return value;
  }

  return "gmail-api";
}

function defaultBaseUrl(provider: GmailMcpProvider) {
  if (provider === "google-official") {
    return GOOGLE_OFFICIAL_BASE_URL;
  }

  return provider === "gmail-api" ? GMAIL_API_BASE_URL : LOCAL_BASE_URL;
}

function defaultHealthTool(provider: GmailMcpProvider) {
  if (provider === "google-official") {
    return "list_labels";
  }

  return provider === "gmail-api" ? "users.profile.get" : "gmail.profile";
}

function defaultSearchTool(provider: GmailMcpProvider) {
  if (provider === "google-official") {
    return "search_threads";
  }

  return provider === "gmail-api" ? "users.messages.list" : "gmail.search";
}

function defaultReadTool(provider: GmailMcpProvider) {
  if (provider === "google-official") {
    return "get_thread";
  }

  return provider === "gmail-api" ? "users.messages.get" : "gmail.read";
}

export function getGmailMcpConfig(overrides: Partial<GmailMcpConfig> = {}): GmailMcpConfig {
  const provider = overrides.provider ?? normalizeProvider(process.env.GMAIL_MCP_PROVIDER);

  return {
    enabled: overrides.enabled ?? envFlag(process.env.GMAIL_MCP_ENABLED),
    provider,
    baseUrl: overrides.baseUrl ?? process.env.GMAIL_MCP_BASE_URL ?? defaultBaseUrl(provider),
    query: overrides.query ?? process.env.GMAIL_MBANK_QUERY ?? DEFAULT_QUERY,
    dailyLookbackDays: overrides.dailyLookbackDays ?? Number(process.env.GMAIL_MBANK_DAILY_LOOKBACK_DAYS ?? 3),
    maxMessages: overrides.maxMessages ?? Number(process.env.GMAIL_MBANK_MAX_MESSAGES ?? DEFAULT_MAX_MESSAGES),
    timeoutMs: overrides.timeoutMs ?? Number(process.env.GMAIL_MCP_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    accessToken: overrides.accessToken ?? process.env.GMAIL_MCP_ACCESS_TOKEN ?? "",
    refreshToken: overrides.refreshToken ?? process.env.GMAIL_MCP_REFRESH_TOKEN ?? "",
    oauthClientId: overrides.oauthClientId ?? process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    oauthClientSecret: overrides.oauthClientSecret ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
    oauthTokenUrl: overrides.oauthTokenUrl ?? process.env.GOOGLE_OAUTH_TOKEN_URL ?? GOOGLE_OAUTH_TOKEN_URL,
    healthTool: overrides.healthTool ?? process.env.GMAIL_MCP_HEALTH_TOOL ?? defaultHealthTool(provider),
    searchTool: overrides.searchTool ?? process.env.GMAIL_MCP_SEARCH_TOOL ?? defaultSearchTool(provider),
    readTool: overrides.readTool ?? process.env.GMAIL_MCP_READ_TOOL ?? defaultReadTool(provider)
  };
}

function isLoopbackHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

export function validateLocalGmailMcpEndpoint(baseUrl: string) {
  try {
    const parsed = new URL(baseUrl);
    const protocolAllowed = parsed.protocol === "http:" || parsed.protocol === "https:";

    if (!protocolAllowed || !isLoopbackHostname(parsed.hostname)) {
      return {
        success: false as const,
        message: "Gmail MCP endpoint must be localhost or loopback."
      };
    }

    return { success: true as const, url: parsed };
  } catch {
    return { success: false as const, message: "Gmail MCP endpoint URL is invalid." };
  }
}

export function validateOfficialGmailMcpEndpoint(baseUrl: string) {
  try {
    const parsed = new URL(baseUrl);

    if (parsed.protocol !== "https:" || parsed.hostname !== "gmailmcp.googleapis.com") {
      return {
        success: false as const,
        message: "Official Gmail MCP endpoint must be https://gmailmcp.googleapis.com."
      };
    }

    return { success: true as const, url: parsed };
  } catch {
    return { success: false as const, message: "Gmail MCP endpoint URL is invalid." };
  }
}

export function validateGmailApiEndpoint(baseUrl: string) {
  try {
    const parsed = new URL(baseUrl);

    if (parsed.protocol !== "https:" || parsed.hostname !== "gmail.googleapis.com") {
      return {
        success: false as const,
        message: "Gmail API endpoint must be https://gmail.googleapis.com."
      };
    }

    return { success: true as const, url: parsed };
  } catch {
    return { success: false as const, message: "Gmail API endpoint URL is invalid." };
  }
}

export function validateGmailMcpEndpoint(baseUrl: string, provider: GmailMcpProvider) {
  if (provider === "google-official") {
    return validateOfficialGmailMcpEndpoint(baseUrl);
  }

  return provider === "gmail-api" ? validateGmailApiEndpoint(baseUrl) : validateLocalGmailMcpEndpoint(baseUrl);
}

export function assertReadOnlyGmailTool(toolName: string) {
  if (!READ_ONLY_GMAIL_TOOLS.has(toolName)) {
    throw new Error(`Gmail MCP tool is not on the read-only allowlist: ${toolName}`);
  }
}

function explainOfficialGmailMcpError(message: string) {
  if (/caller does not have permission|permission denied|access denied/i.test(message)) {
    return [
      message,
      "Google official Gmail MCP rejected the OAuth caller.",
      "Verify that this Google Cloud project/account has Gmail MCP Developer Preview access and that the token was generated with the required scopes, or switch to the gmail-api provider."
    ].join(" ");
  }

  return message;
}

async function fetchWithTimeout(url: URL | string, init: RequestInit, timeoutMs: number) {
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

async function refreshGoogleAccessToken(config: GmailMcpConfig) {
  if (!config.refreshToken || !config.oauthClientId || !config.oauthClientSecret) {
    throw new Error("Gmail access requires GMAIL_MCP_ACCESS_TOKEN or GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GMAIL_MCP_REFRESH_TOKEN.");
  }

  if (cachedOAuthToken && cachedOAuthToken.expiresAt > Date.now() + 30_000) {
    return cachedOAuthToken.accessToken;
  }

  const response = await fetchWithTimeout(
    config.oauthTokenUrl,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.oauthClientId,
        client_secret: config.oauthClientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token"
      })
    },
    config.timeoutMs
  );

  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: unknown;
    expires_in?: unknown;
    error?: unknown;
    error_description?: unknown;
  };

  if (!response.ok || typeof payload.access_token !== "string") {
    const detail = typeof payload.error_description === "string" ? payload.error_description : typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    throw new Error(`Google OAuth token refresh failed: ${detail}`);
  }

  cachedOAuthToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(Number(payload.expires_in ?? 3600) - 60, 60) * 1000
  };

  return cachedOAuthToken.accessToken;
}

async function buildMcpHeaders(config: GmailMcpConfig): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18"
  };

  if (config.provider === "google-official") {
    const accessToken = config.accessToken || (await refreshGoogleAccessToken(config));
    headers.authorization = `Bearer ${accessToken}`;
  }

  return headers;
}

async function buildGoogleAuthHeaders(config: GmailMcpConfig): Promise<HeadersInit> {
  const accessToken = config.accessToken || (await refreshGoogleAccessToken(config));
  return {
    accept: "application/json",
    authorization: `Bearer ${accessToken}`
  };
}

function parseSseJson(text: string): unknown {
  const data = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .join("\n");

  return JSON.parse(data || text);
}

async function readMcpResponseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (!text) {
    return {};
  }

  if (contentType.includes("text/event-stream")) {
    return parseSseJson(text);
  }

  return JSON.parse(text);
}

function parseToolPayload(json: unknown): unknown {
  const value = json as { result?: unknown; content?: unknown; error?: { message?: unknown } };

  if (value.error) {
    throw new Error(typeof value.error.message === "string" ? value.error.message : "Gmail MCP JSON-RPC error.");
  }

  const result = value.result ?? json;
  const resultValue = result as { content?: unknown; structuredContent?: unknown; data?: unknown };

  if (resultValue.structuredContent !== undefined) {
    return resultValue.structuredContent;
  }

  if (resultValue.data !== undefined) {
    return resultValue.data;
  }

  if (Array.isArray(resultValue.content)) {
    for (const item of resultValue.content as Array<{ text?: unknown }>) {
      if (typeof item.text === "string") {
        const text = item.text.trim();
        if (/permission|scope|not authorized|access denied/i.test(text)) {
          throw new Error(text);
        }
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }
    }
  }

  return result;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function dateValue(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function unwrapListPayload(payload: unknown): unknown[] {
  const value = payload as {
    messages?: unknown;
    results?: unknown;
    items?: unknown;
    threads?: unknown;
    labels?: unknown;
    content?: unknown;
  };
  const candidates = [value.messages, value.results, value.items, value.threads, value.labels, value.content, payload];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function normalizeMessage(input: unknown): GmailMessageSummary | null {
  const value = input as Record<string, unknown>;
  const id = value.id ?? value.messageId ?? value.gmailMessageId ?? value.threadId;

  if (typeof id !== "string") {
    return null;
  }

  const receivedAt = dateValue(value.receivedAt ?? value.date ?? value.dateHeader ?? value.internalDate ?? value.latestMessageDate);
  const threadId = typeof value.threadId === "string" ? value.threadId : typeof value.id === "string" ? value.id : null;

  return {
    id,
    threadId,
    subject: stringValue(value.subject ?? value.title),
    sender: stringValue(value.sender ?? value.from),
    receivedAt,
    snippet: stringValue(value.snippet ?? value.preview)
  };
}

function collectBodyText(value: unknown, fragments: string[] = [], depth = 0) {
  if (depth > 4 || value === null || value === undefined) {
    return fragments;
  }

  if (typeof value === "string") {
    if (value.trim()) {
      fragments.push(value);
    }
    return fragments;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectBodyText(item, fragments, depth + 1);
    }
    return fragments;
  }

  if (typeof value !== "object") {
    return fragments;
  }

  const record = value as Record<string, unknown>;
  const preferredKeys = ["bodyText", "plainText", "plaintextBody", "textPlain", "text", "body", "content", "snippet"];

  for (const key of preferredKeys) {
    if (key in record) {
      collectBodyText(record[key], fragments, depth + 1);
    }
  }

  return fragments;
}

function normalizeMessageBody(input: unknown, fallback: GmailMessageSummary): GmailMessageBody {
  const value = input as Record<string, unknown>;
  const messages = Array.isArray(value.messages) ? value.messages : [];
  const lastMessage = (messages[messages.length - 1] ?? {}) as Record<string, unknown>;
  const bodyText = collectBodyText(messages.length > 0 ? messages : value).join("\n\n") || fallback.snippet || "";

  return {
    ...fallback,
    id: stringValue(value.id ?? value.messageId ?? lastMessage.id) ?? fallback.id,
    threadId: stringValue(value.threadId ?? lastMessage.threadId) ?? fallback.threadId,
    subject: stringValue(value.subject ?? lastMessage.subject) ?? fallback.subject,
    sender: stringValue(value.sender ?? value.from ?? lastMessage.sender ?? lastMessage.from) ?? fallback.sender,
    bodyText
  };
}

type GmailApiListResponse = {
  messages?: Array<{ id?: string; threadId?: string }>;
  resultSizeEstimate?: number;
};

type GmailApiHeader = {
  name?: string;
  value?: string;
};

type GmailApiMessagePart = {
  filename?: string;
  mimeType?: string;
  headers?: GmailApiHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailApiMessagePart[];
};

type GmailApiMessageResponse = {
  id?: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailApiMessagePart;
};

type GmailApiAttachmentResponse = {
  data?: string;
  size?: number;
};

function gmailApiUrl(config: GmailMcpConfig, path: string) {
  const endpoint = validateGmailApiEndpoint(config.baseUrl);

  if (!endpoint.success) {
    throw new Error(endpoint.message);
  }

  const basePath = endpoint.url.pathname.replace(/\/$/, "");
  const url = new URL(endpoint.url.href);
  url.pathname = `${basePath}${path}`;
  url.search = "";
  return url;
}

function gmailApiError(payload: unknown, status: number) {
  const value = payload as { error?: { message?: unknown; status?: unknown } };
  const message = typeof value.error?.message === "string" ? value.error.message : `HTTP ${status}`;
  return `Gmail API returned HTTP ${status}: ${message}`;
}

async function fetchGmailApiJson<T>(config: GmailMcpConfig, path: string, params: Record<string, string> = {}) {
  const url = gmailApiUrl(config, path);

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: await buildGoogleAuthHeaders(config)
    },
    config.timeoutMs
  );
  const payload = (await response.json().catch(() => ({}))) as T;

  if (!response.ok) {
    throw new Error(gmailApiError(payload, response.status));
  }

  return payload;
}

function decodeBase64UrlBuffer(data: string) {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padding), "base64");
}

function replacementScore(value: string) {
  return (value.match(/�/g) ?? []).length;
}

function decodeTextBuffer(buffer: Buffer, hint = "") {
  const asciiHint = buffer.subarray(0, 2048).toString("latin1").toLowerCase() + " " + hint.toLowerCase();
  const charset = asciiHint.match(/charset=["']?([a-z0-9_-]+)/i)?.[1];
  const encodings = [charset, "utf-8", "windows-1250", "iso-8859-2"].filter((encoding): encoding is string => Boolean(encoding));
  let best = buffer.toString("utf8");
  let bestScore = replacementScore(best);

  for (const encoding of encodings) {
    try {
      const decoded = new TextDecoder(encoding).decode(buffer);
      const score = replacementScore(decoded);
      if (score < bestScore) {
        best = decoded;
        bestScore = score;
      }
    } catch {
      // Ignore unsupported charset labels and keep the best decoded text so far.
    }
  }

  return best;
}

function decodeBase64Url(data: string, hint = "") {
  return decodeTextBuffer(decodeBase64UrlBuffer(data), hint);
}

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function headerValue(part: GmailApiMessagePart | undefined, headerName: string) {
  const lowerName = headerName.toLowerCase();
  return part?.headers?.find((header) => header.name?.toLowerCase() === lowerName)?.value ?? null;
}

function gmailApiReceivedAt(message: GmailApiMessageResponse, dateHeader: string | null) {
  if (typeof message.internalDate === "string") {
    const timestamp = Number(message.internalDate);
    if (Number.isFinite(timestamp)) {
      return new Date(timestamp);
    }
  }

  return dateValue(dateHeader);
}

function collectGmailApiBodyText(part: GmailApiMessagePart | undefined, buckets: { plain: string[]; html: string[] }) {
  if (!part) {
    return buckets;
  }

  const data = part.body?.data;
  if (typeof data === "string") {
    try {
      const decoded = decodeBase64Url(data, `${part.mimeType ?? ""} ${part.filename ?? ""}`).trim();
      if (decoded) {
        const mimeType = (part.mimeType ?? "").toLowerCase();
        if (mimeType.includes("text/html")) {
          buckets.html.push(stripHtml(decoded));
        } else if (mimeType.includes("text/plain") || !part.parts?.length) {
          buckets.plain.push(decoded);
        }
      }
    } catch {
      // Ignore undecodable MIME parts and keep looking for a readable body part.
    }
  }

  for (const child of part.parts ?? []) {
    collectGmailApiBodyText(child, buckets);
  }

  return buckets;
}

type GmailApiTextAttachment = {
  attachmentId: string;
  filename: string | null;
};

function collectGmailApiHtmlAttachments(part: GmailApiMessagePart | undefined, attachments: GmailApiTextAttachment[] = []) {
  if (!part) {
    return attachments;
  }

  const filename = part.filename?.trim() || null;
  const mimeType = (part.mimeType ?? "").toLowerCase();
  const attachmentId = part.body?.attachmentId;
  const looksLikeHtml = mimeType === "text/html" || Boolean(filename?.toLowerCase().match(/\.html?$/));

  if (looksLikeHtml && typeof attachmentId === "string") {
    attachments.push({ attachmentId, filename });
  }

  for (const child of part.parts ?? []) {
    collectGmailApiHtmlAttachments(child, attachments);
  }

  return attachments;
}

async function extractGmailApiHtmlAttachmentTexts(messageId: string, payload: GmailApiMessageResponse, config: GmailMcpConfig) {
  const attachments = collectGmailApiHtmlAttachments(payload.payload);
  const texts: string[] = [];

  for (const attachment of attachments) {
    const response = await fetchGmailApiJson<GmailApiAttachmentResponse>(
      config,
      `/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.attachmentId)}`
    );

    if (typeof response.data !== "string") {
      continue;
    }

    const text = decodeBase64Url(response.data, `${attachment.filename ?? ""} text/html`).trim();
    if (text) {
      texts.push(text);
    }
  }

  return texts;
}

async function searchGmailApiMessages(config: GmailMcpConfig): Promise<GmailMessageSummary[]> {
  const query = config.query.trim();
  const maxResults = Math.max(config.maxMessages, 1);
  const payload = await fetchGmailApiJson<GmailApiListResponse>(config, "/users/me/messages", {
    maxResults: String(maxResults),
    ...(query ? { q: query } : {})
  });
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const normalized: GmailMessageSummary[] = [];

  for (const message of messages) {
    if (typeof message.id !== "string") {
      continue;
    }

    normalized.push({
      id: message.id,
      threadId: typeof message.threadId === "string" ? message.threadId : null,
      subject: null,
      sender: null,
      receivedAt: null,
      snippet: null
    });
  }

  return config.maxMessages > 0 ? normalized.slice(0, config.maxMessages) : normalized;
}

async function readGmailApiMessage(message: GmailMessageSummary, config: GmailMcpConfig): Promise<GmailMessageBody> {
  const payload = await fetchGmailApiJson<GmailApiMessageResponse>(config, `/users/me/messages/${encodeURIComponent(message.id)}`, { format: "full" });
  const dateHeader = headerValue(payload.payload, "Date");
  const buckets = collectGmailApiBodyText(payload.payload, { plain: [], html: [] });
  const emailText = [...buckets.plain, ...buckets.html].map((fragment) => fragment.trim()).filter(Boolean).join("\n\n");
  const htmlAttachmentTexts = await extractGmailApiHtmlAttachmentTexts(typeof payload.id === "string" ? payload.id : message.id, payload, config);
  const bodyText = [emailText, ...htmlAttachmentTexts].filter(Boolean).join("\n\n") || payload.snippet || message.snippet || "";

  return {
    ...message,
    id: typeof payload.id === "string" ? payload.id : message.id,
    threadId: typeof payload.threadId === "string" ? payload.threadId : message.threadId,
    subject: headerValue(payload.payload, "Subject") ?? message.subject,
    sender: headerValue(payload.payload, "From") ?? message.sender,
    receivedAt: gmailApiReceivedAt(payload, dateHeader) ?? message.receivedAt ?? null,
    snippet: payload.snippet ?? message.snippet,
    bodyText
  };
}

export async function callGmailMcpReadOnlyTool(toolName: string, args: Record<string, unknown>, config = getGmailMcpConfig()) {
  if (config.provider === "gmail-api") {
    throw new Error("The gmail-api provider uses Gmail REST API endpoints, not MCP tools.");
  }

  assertReadOnlyGmailTool(toolName);
  const endpoint = validateGmailMcpEndpoint(config.baseUrl, config.provider);

  if (!endpoint.success) {
    throw new Error(endpoint.message);
  }

  const response = await fetchWithTimeout(
    endpoint.url,
    {
      method: "POST",
      headers: await buildMcpHeaders(config),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args
        }
      })
    },
    config.timeoutMs
  );

  if (!response.ok) {
    throw new Error(`Gmail MCP returned HTTP ${response.status}.`);
  }

  return parseToolPayload(await readMcpResponseJson(response));
}

export async function checkGmailMcpHealth(overrides: Partial<GmailMcpConfig> = {}): Promise<GmailMcpHealth> {
  const config = getGmailMcpConfig(overrides);
  const endpoint = validateGmailMcpEndpoint(config.baseUrl, config.provider);

  if (!config.enabled) {
    return {
      enabled: false,
      available: false,
      provider: config.provider,
      baseUrl: config.baseUrl,
      reason: config.provider === "gmail-api" ? "Gmail API disabled in env." : "Gmail MCP disabled in env."
    };
  }

  if (!endpoint.success) {
    return {
      enabled: true,
      available: false,
      provider: config.provider,
      baseUrl: config.baseUrl,
      reason: endpoint.message
    };
  }

  try {
    if (config.provider === "gmail-api") {
      await fetchGmailApiJson(config, "/users/me/profile");
      return {
        enabled: true,
        available: true,
        provider: config.provider,
        baseUrl: config.baseUrl,
        reason: "Gmail API read-only profile call succeeded."
      };
    }

    await callGmailMcpReadOnlyTool(config.healthTool, {}, config);
    return {
      enabled: true,
      available: true,
      provider: config.provider,
      baseUrl: config.baseUrl,
      reason: `Gmail MCP read-only ${config.healthTool} call succeeded.`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : config.provider === "gmail-api" ? "Gmail API unavailable." : "Gmail MCP unavailable.";

    return {
      enabled: true,
      available: false,
      provider: config.provider,
      baseUrl: config.baseUrl,
      reason: config.provider === "google-official" ? explainOfficialGmailMcpError(message) : message
    };
  }
}

function searchArgs(config: GmailMcpConfig) {
  const query = config.query.trim();

  if (config.provider === "google-official") {
    return query ? { query, pageSize: config.maxMessages } : { pageSize: config.maxMessages };
  }

  return query ? { query } : {};
}

export async function searchMbankMessages(overrides: Partial<GmailMcpConfig> = {}): Promise<GmailMessageSummary[]> {
  const config = getGmailMcpConfig(overrides);
  if (!config.enabled) {
    return [];
  }

  if (config.provider === "gmail-api") {
    return searchGmailApiMessages(config);
  }

  const payload = await callGmailMcpReadOnlyTool(config.searchTool, searchArgs(config), config);
  const list = unwrapListPayload(payload);
  const normalized = list.map(normalizeMessage).filter((message): message is GmailMessageSummary => Boolean(message));
  return config.maxMessages > 0 ? normalized.slice(0, config.maxMessages) : normalized;
}

function readArgs(message: GmailMessageSummary, config: GmailMcpConfig) {
  if (config.provider === "google-official") {
    return { threadId: message.threadId ?? message.id, messageFormat: "FULL_CONTENT" };
  }

  return { messageId: message.id };
}

export async function readGmailMessage(message: GmailMessageSummary, overrides: Partial<GmailMcpConfig> = {}): Promise<GmailMessageBody> {
  const config = getGmailMcpConfig(overrides);
  if (config.provider === "gmail-api") {
    return readGmailApiMessage(message, config);
  }

  const payload = await callGmailMcpReadOnlyTool(config.readTool, readArgs(message, config), config);
  return normalizeMessageBody(payload, message);
}
