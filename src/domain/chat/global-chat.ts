import type { PrismaClient } from "@prisma/client";
import { assemblePortfolioContext } from "@/domain/portfolio/context-assembler";
import { writeChatObservation } from "@/domain/memory/observational-memory";
import { traceStep } from "@/domain/tracing/local-tracing";
import { chatWithLocalLlm, type LocalLlmChatMessage } from "@/lib/llm/local-llm-client";

const RESOURCE_ID = "local-user";
const HISTORY_LIMIT = 6;
const HISTORY_MESSAGE_MAX_CHARS = 800;
const LLM_FAILURE_PREFIX = "Local LLM unavailable:";

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

type PortfolioContextData = Awaited<ReturnType<typeof assemblePortfolioContext>>;

// The local model runs on modest hardware with a small context window, so the
// payload has to stay compact: prompt processing above ~2.5k tokens pushes a
// CPU-only gemma3:4b past the request timeout.
const CHAT_LLM_TIMEOUT_MS = 120_000;
const CHAT_LLM_MAX_RESPONSE_TOKENS = 400;

function clip(value: string | null | undefined, maxChars: number) {
  if (!value) {
    return value ?? null;
  }

  return value.length > maxChars ? `${value.slice(0, maxChars)}…` : value;
}

function buildContextPayload(context: PortfolioContextData) {
  return {
    asOf: context.asOf.toISOString().slice(0, 10),
    baseCurrency: context.baseCurrency,
    totalPortfolioValue: context.totalValue,
    allocationByClass: context.allocationByClass,
    topPositions: context.allocationByPosition.slice(0, 6),
    targetAllocation: context.strategy.targetAllocation,
    profile: {
      lifeStage: context.strategy.lifeStage,
      riskTolerance: context.strategy.riskTolerance,
      investmentHorizonYears: context.strategy.investmentHorizonYears,
      monthlyIncome: context.strategy.monthlyIncome,
      monthlyFixedCosts: context.strategy.monthlyFixedCosts,
      monthlyInvestmentCapacity: context.strategy.monthlyInvestmentCapacity,
      goals: context.strategy.goals.slice(0, 3),
      constraints: context.strategy.constraints.slice(0, 3)
    },
    spendingSummary: context.spendingSummary,
    recentTransactions: context.transactions.slice(0, 20).map((transaction) => ({
      date: transaction.operationDate.toISOString().slice(0, 10),
      amount: transaction.amount,
      direction: transaction.direction,
      category: transaction.category,
      description: clip(transaction.merchant ?? transaction.description, 80)
    })),
    reports: context.reports.slice(0, 2).map((report) => ({
      title: clip(report.title, 90),
      summary: clip(report.summary, 240),
      createdAt: report.createdAt.toISOString().slice(0, 10)
    })),
    observations: context.memory.observations.slice(0, 5).map((observation) => ({
      topic: observation.topic,
      content: clip(observation.content, 140)
    })),
    reflections: context.memory.reflections.slice(0, 2).map((reflection) => clip(reflection.summary, 160)),
    missingData: context.missingData.slice(0, 4)
  };
}

export function buildChatMessages(
  context: PortfolioContextData,
  history: Array<{ role: string; content: string }>,
  userMessage: string
): LocalLlmChatMessage[] {
  const language = context.strategy.preferredReportLanguage === "en" ? "angielsku" : "polsku";
  const system: LocalLlmChatMessage = {
    role: "system",
    content: [
      "Jesteś lokalnym asystentem finansowym Portfolio Copilot.",
      "Odpowiadasz wyłącznie na podstawie lokalnego kontekstu poniżej: transakcji, raportów, alokacji portfela, profilu, importów i pamięci.",
      "Nie wykonujesz przelewów, zleceń, zmian Gmail ani zmian strategii - aplikacja jest w trybie tylko do odczytu.",
      "Podawaj konkretne liczby z kontekstu (kwoty w PLN, procenty). Jeśli danych brakuje, powiedz dokładnie czego brakuje.",
      "Możesz używać prostego Markdownu: pogrubienia i list punktowanych.",
      `Odpowiadaj zwięźle po ${language}.`,
      "",
      "Lokalny kontekst JSON:",
      JSON.stringify(buildContextPayload(context))
    ].join("\n")
  };

  const conversation: LocalLlmChatMessage[] = history
    .filter(
      (message): message is { role: "user" | "assistant"; content: string } =>
        (message.role === "user" || message.role === "assistant") && !message.content.startsWith(LLM_FAILURE_PREFIX)
    )
    .map((message) => ({
      role: message.role,
      content: message.content.length > HISTORY_MESSAGE_MAX_CHARS ? `${message.content.slice(0, HISTORY_MESSAGE_MAX_CHARS)}…` : message.content
    }));

  return [system, ...conversation, { role: "user", content: userMessage }];
}

export async function sendGlobalChatMessage(db: PrismaClient, input: { content: string; llmModel?: string }) {
  const thread = await getOrCreateGlobalChatThread(db);
  const content = input.content.trim();

  if (content.length === 0) {
    throw new Error("Chat message cannot be empty.");
  }

  const recentMessages = await db.chatMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT
  });
  const history = recentMessages.reverse();

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
    chatWithLocalLlm(buildChatMessages(context, history, content), {
      model: input.llmModel,
      timeoutMs: CHAT_LLM_TIMEOUT_MS,
      numPredict: CHAT_LLM_MAX_RESPONSE_TOKENS
    })
  );

  if (!result.success) {
    const assistant = await db.chatMessage.create({
      data: {
        threadId: thread.id,
        role: "assistant",
        content: `${LLM_FAILURE_PREFIX} ${result.error.message}`,
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
