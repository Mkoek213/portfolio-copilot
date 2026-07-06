import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const TOKEN_URL = process.env.GOOGLE_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token";
const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const REQUIRED_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error("Missing " + name + ".");
  }
  return value;
}

async function main() {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_OAUTH_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
      refresh_token: requiredEnv("GMAIL_MCP_REFRESH_TOKEN"),
      grant_type: "refresh_token"
    })
  });

  const tokenPayload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !tokenPayload.access_token) {
    console.log(JSON.stringify({
      tokenRefresh: "failed",
      error: tokenPayload.error ?? "unknown_error",
      errorDescription: tokenPayload.error_description ?? null
    }, null, 2));
    process.exit(1);
  }

  const tokenInfoUrl = new URL(TOKENINFO_URL);
  tokenInfoUrl.searchParams.set("access_token", tokenPayload.access_token);
  const infoResponse = await fetch(tokenInfoUrl);
  const info = (await infoResponse.json().catch(() => ({}))) as { scope?: string; error?: string; error_description?: string; expires_in?: string };

  if (!infoResponse.ok) {
    console.log(JSON.stringify({
      tokenRefresh: "ok",
      tokenInfo: "failed",
      error: info.error ?? "unknown_error",
      errorDescription: info.error_description ?? null
    }, null, 2));
    process.exit(1);
  }

  const scopes = String(info.scope ?? tokenPayload.scope ?? "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
    .sort();
  const missingScopes = REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope));

  console.log(JSON.stringify({
    tokenRefresh: "ok",
    expiresInSeconds: info.expires_in ?? null,
    grantedScopes: scopes,
    requiredScopes: REQUIRED_SCOPES,
    missingScopes,
    readyForGmailApi: missingScopes.length === 0
  }, null, 2));

  if (missingScopes.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
