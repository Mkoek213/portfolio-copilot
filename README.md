# portfolio-copilot

Local read-only financial cockpit for one user. The app imports normalized mBank transactions through a read-only Gmail API adapter, runs a local agent-style analysis flow, keeps local memory, and exposes reports, imports, strategy, memory, chat and settings through a tabbed Next.js UI.

The app never executes transfers, orders, Gmail mutations or broker actions. Hosted LLM providers are intentionally unsupported.

## Local setup

```bash
cp .env.example .env
npm install
docker compose up -d
npm run db:migrate
npm run db:seed
npm run dev
```

Open the URL printed by Next.js. If port `3000` is busy, Next will choose another local port.

## Optional local services

### Ollama / Gemma

```bash
ollama pull gemma3:4b
ollama run gemma3:4b
```

Set `LLM_REPORTER_ENABLED=true` to let reports try the local Gemma reporter. If Ollama or the selected model is unavailable, the workflow saves a warning and falls back to the deterministic reporter.

### Gmail API for mBank imports

Use the standard Gmail REST API with a Google OAuth web client:

```bash
GMAIL_MCP_ENABLED=true
GMAIL_MCP_PROVIDER=gmail-api
GMAIL_MCP_BASE_URL=https://gmail.googleapis.com/gmail/v1
GOOGLE_OAUTH_CLIENT_ID="<client-id>"
GOOGLE_OAUTH_CLIENT_SECRET="<client-secret>"
GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:3006/oauth/callback
GMAIL_MCP_REFRESH_TOKEN="<refresh-token-from-npm-run-gmail-auth>"
GMAIL_MCP_OAUTH_SCOPES=https://www.googleapis.com/auth/gmail.readonly
GMAIL_MBANK_QUERY="rfc822msgid:<one-known-message-id>"
GMAIL_MBANK_MAX_MESSAGES=1
```

After creating a Google OAuth web client, run `npm run gmail:auth` to generate the local refresh token. The adapter calls only read-only Gmail API endpoints: `users.getProfile`, `users.messages.list`, `users.messages.get` and, for HTML notification emails, `users.messages.attachments.get`. Raw emails are parsed in memory and are not stored. Start with a single known message; broad Gmail backfill is intentionally out of scope for this stage.

See `docs/real-import-runbook.md` for setup and operating details, `docs/manual-real-e2e-checklist.md` for the no-raw manual proof template, and `docs/release-notes-real-import.md` for limits and proposed commit split.

### Local Langfuse

Langfuse is optional and local-only:

```bash
docker compose --profile langfuse up -d
```

Then set:

```bash
LANGFUSE_ENABLED=true
LANGFUSE_BASE_URL=http://localhost:3005
```

Trace spans are also stored locally in the app database, so missing Langfuse never breaks analysis, imports or chat.

## Verification

```bash
npm test
npm run lint
npm run typecheck
npm run build

# Optional real-service readiness check. This does not persist raw Gmail body.
npm run gate:real
```
