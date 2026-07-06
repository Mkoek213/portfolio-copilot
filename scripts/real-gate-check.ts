import { loadEnvConfig } from "@next/env";
import { checkGmailMcpHealth, getGmailMcpConfig, searchMbankMessages } from "../src/domain/imports/gmail-mcp-adapter";
import { checkLocalLlmHealth } from "../src/lib/llm/local-llm-client";

loadEnvConfig(process.cwd());

type GateLine = {
  gate: string;
  status: "go" | "no-go" | "warn";
  detail: string;
};

function line(gate: string, status: GateLine["status"], detail: string): GateLine {
  return { gate, status, detail };
}

function hasNarrowGmailQuery(query: string) {
  return query.trim().length > 0;
}

async function main() {
  const gmailConfig = getGmailMcpConfig();
  const [gmailHealth, localLlmHealth] = await Promise.all([checkGmailMcpHealth(), checkLocalLlmHealth()]);
  const queryLabel = gmailConfig.query.trim() ? gmailConfig.query : "(all threads)";
  const lines: GateLine[] = [];

  lines.push(
    line(
      "gmail-" + gmailConfig.provider + "-readonly",
      gmailHealth.available ? "go" : "no-go",
      (gmailHealth.enabled ? "enabled" : "disabled") + "; provider=" + gmailHealth.provider + "; " + gmailHealth.reason + "; endpoint=" + gmailHealth.baseUrl
    )
  );

  lines.push(
    line(
      "gmail-single-message-window",
      gmailConfig.maxMessages === 1 ? "go" : "no-go",
      "GMAIL_MBANK_MAX_MESSAGES=" + gmailConfig.maxMessages + "; query=" + queryLabel
    )
  );

  lines.push(
    line(
      "gmail-query-narrowed",
      hasNarrowGmailQuery(gmailConfig.query) ? "go" : "no-go",
      hasNarrowGmailQuery(gmailConfig.query)
        ? "GMAIL_MBANK_QUERY=" + queryLabel
        : "GMAIL_MBANK_QUERY is empty; set a narrow query such as rfc822msgid:<known-message-id> before real import."
    )
  );

  if (gmailHealth.available) {
    try {
      const messages = await searchMbankMessages();
      lines.push(
        line(
          "gmail-search-preview",
          messages.length === 1 ? "go" : messages.length === 0 ? "warn" : "no-go",
          "search returned " + messages.length + " message(s); first id suffix=" + (messages[0]?.id.slice(-8) ?? "none")
        )
      );
    } catch (error) {
      lines.push(line("gmail-search-preview", "no-go", error instanceof Error ? error.message : "Gmail search failed."));
    }
  }

  lines.push(
    line(
      "local-gemma-health",
      localLlmHealth.available && localLlmHealth.model === "gemma3:4b" ? "go" : "no-go",
      localLlmHealth.reason + "; model=" + localLlmHealth.model + "; enabled=" + localLlmHealth.enabled
    )
  );

  lines.push(
    line(
      "reporter-enabled",
      localLlmHealth.enabled ? "go" : "no-go",
      "LLM_REPORTER_ENABLED=" + localLlmHealth.enabled
    )
  );

  const noGo = lines.filter((item) => item.status === "no-go");

  for (const item of lines) {
    console.log(item.status.toUpperCase() + " " + item.gate + " - " + item.detail);
  }

  if (noGo.length > 0) {
    console.error("Real gate is not ready: " + noGo.map((item) => item.gate).join(", "));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
