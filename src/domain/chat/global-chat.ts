import type { PrismaClient } from "@prisma/client";
import { assemblePortfolioContext } from "@/domain/portfolio/context-assembler";
import { writeChatObservation } from "@/domain/memory/observational-memory";
import { traceStep } from "@/domain/tracing/local-tracing";
import { chatWithLocalLlm, type LocalLlmChatMessage } from "@/lib/llm/local-llm-client";

const RESOURCE_ID = "local-user";

export async function getOrCreateGlobalChatThread(db: PrismaClient) {
  const existing = await db.chatThread.findFirst({
    where: { resourceId: RESOURCE_ID },
    orderBy: { updatedAt: "desc" }
  });

  if (existing) {
    return existing;
  }

  return db.chatThread.create({
    data: {
      resourceId: RESOURCE_ID,
      title: "Global local assistant"
    }
  });
}

function buildMessages(context: Awaited<ReturnType<typeof assemblePortfolioContext>>, userMessage: string): LocalLlmChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "Jesteś lokalnym asystentem Portfolio Copilot.",
        "Odpowiadasz wyłącznie na podstawie lokalnego kontekstu: transakcji, raportów, profilu, importów i pamięci.",
        "Nie wykonujesz przelewów, zleceń, zmian Gmail ani zmian strategii bez jawnej akcji UI.",
        "Jeśli brakuje danych, powiedz konkretnie czego brakuje.",
        "Odpowiadaj krótko po polsku."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        "Lokalny kontekst JSON:",
        JSON.stringify(
          {
            profile: context.strategy,
            spendingSummary: context.spendingSummary,
            transactions: context.transactions.slice(0, 60),
            reports: context.reports.slice(0, 5),
            imports: context.imports.slice(0, 10),
            observations: context.memory.observations.slice(0, 12),
            reflections: context.memory.reflections.slice(0, 4),
            missingData: context.missingData
          },
          null,
          2
        ),
        "",
        `Pytanie użytkownika: ${userMessage}`
      ].join("\n")
    }
  ];
}

export async function sendGlobalChatMessage(db: PrismaClient, input: { content: string; llmModel?: string }) {
  const thread = await getOrCreateGlobalChatThread(db);
  const content = input.content.trim();

  if (content.length === 0) {
    throw new Error("Chat message cannot be empty.");
  }

  const userMessage = await db.chatMessage.create({
    data: {
      threadId: thread.id,
      role: "user",
      content
    }
  });

  const traceId = `chat-${userMessage.id}`;
  const context = await traceStep(db, { traceId, resourceId: RESOURCE_ID, name: "chat.context" }, () => assemblePortfolioContext(db));
  const result = await traceStep(db, { traceId, resourceId: RESOURCE_ID, name: "chat.local-llm", metadata: { model: input.llmModel } }, () =>
    chatWithLocalLlm(buildMessages(context, content), { model: input.llmModel })
  );

  if (!result.success) {
    const assistant = await db.chatMessage.create({
      data: {
        threadId: thread.id,
        role: "assistant",
        content: `Local LLM unavailable: ${result.error.message}`,
        metadata: { error: result.error }
      }
    });

    await db.chatThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
    return { success: false as const, threadId: thread.id, userMessage, assistantMessage: assistant, error: result.error };
  }

  const assistantMessage = await db.chatMessage.create({
    data: {
      threadId: thread.id,
      role: "assistant",
      content: result.content,
      metadata: { model: result.model }
    }
  });

  await db.chatThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
  await writeChatObservation(db, {
    resourceId: RESOURCE_ID,
    threadId: thread.id,
    userMessage: content,
    assistantMessage: result.content
  });

  return { success: true as const, threadId: thread.id, userMessage, assistantMessage, model: result.model };
}
