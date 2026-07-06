import { loadEnvConfig } from "@next/env";
import { getGmailMcpConfig, searchMbankMessages } from "../src/domain/imports/gmail-mcp-adapter";

loadEnvConfig(process.cwd());

async function main() {
  const config = getGmailMcpConfig();
  const messages = await searchMbankMessages();

  console.log(JSON.stringify({
    provider: config.provider,
    endpoint: config.baseUrl,
    query: config.query || "(all threads)",
    maxMessages: config.maxMessages,
    messageCount: messages.length,
    firstMessage: messages[0]
      ? {
          idSuffix: messages[0].id.slice(-8),
          threadIdSuffix: messages[0].threadId?.slice(-8) ?? null,
          subjectPresent: Boolean(messages[0].subject),
          senderPresent: Boolean(messages[0].sender),
          receivedAtPresent: Boolean(messages[0].receivedAt)
        }
      : null
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
