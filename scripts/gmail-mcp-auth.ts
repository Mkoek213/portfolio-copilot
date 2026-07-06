import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const DEFAULT_REDIRECT_URI = "http://127.0.0.1:3006/oauth/callback";
const DEFAULT_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

function requiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}. Put it in .env before running this helper.`);
  }

  return value;
}

function parseScopes() {
  const raw = process.env.GMAIL_MCP_OAUTH_SCOPES;
  if (!raw) {
    return DEFAULT_SCOPES;
  }

  return raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requiredEnv("GOOGLE_OAUTH_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });

  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok) {
    const detail = payload.error_description ?? payload.error ?? `HTTP ${response.status}`;
    throw new Error(`Google OAuth exchange failed: ${detail}`);
  }

  return payload;
}

async function main() {
  const clientId = requiredEnv("GOOGLE_OAUTH_CLIENT_ID");
  requiredEnv("GOOGLE_OAUTH_CLIENT_SECRET");

  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || DEFAULT_REDIRECT_URI;
  const redirect = new URL(redirectUri);
  const state = randomBytes(16).toString("hex");
  const scopes = parseScopes();

  if (redirect.hostname !== "127.0.0.1" && redirect.hostname !== "localhost") {
    throw new Error("GOOGLE_OAUTH_REDIRECT_URI must be localhost or 127.0.0.1 for this helper.");
  }

  const authUrl = new URL(AUTH_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", scopes.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("state", state);

  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? "/", redirectUri);

      if (requestUrl.pathname !== redirect.pathname) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not found");
        return;
      }

      const error = requestUrl.searchParams.get("error");
      if (error) {
        throw new Error(`Google OAuth returned error: ${error}`);
      }

      if (requestUrl.searchParams.get("state") !== state) {
        throw new Error("OAuth state mismatch.");
      }

      const code = requestUrl.searchParams.get("code");
      if (!code) {
        throw new Error("OAuth callback did not include a code.");
      }

      const tokens = await exchangeCodeForTokens(code, redirectUri);

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<h1>Gmail API OAuth complete</h1><p>You can close this browser tab and return to the terminal.</p>");

      console.log("\nOAuth complete. Add these values to .env:");
      console.log("GMAIL_MCP_PROVIDER=gmail-api");
      console.log("GMAIL_MCP_ENABLED=true");
      console.log("GMAIL_MCP_BASE_URL=https://gmail.googleapis.com/gmail/v1");
      console.log("GMAIL_MCP_OAUTH_SCOPES=https://www.googleapis.com/auth/gmail.readonly");
      if (tokens.refresh_token) {
        console.log(`GMAIL_MCP_REFRESH_TOKEN=${tokens.refresh_token}`);
      } else {
        console.log("GMAIL_MCP_REFRESH_TOKEN=<not returned by Google>");
        console.log("Google did not return a refresh token. Revoke the app grant in your Google Account and run this helper again.");
      }
      console.log("LLM_REPORTER_ENABLED=true");
      console.log("\nKeep GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env too.");
      server.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : "OAuth failed.";
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(message);
      console.error(message);
      server.close(() => process.exit(1));
    }
  });

  server.listen(Number(redirect.port || 80), redirect.hostname, () => {
    console.log("Open this URL in your browser and approve Gmail API read-only access:\n");
    console.log(authUrl.toString());
    console.log("\nWaiting for OAuth callback on " + redirectUri);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
