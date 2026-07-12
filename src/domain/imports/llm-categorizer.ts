import type { ExpenseCategory, TransactionDirection } from "@/domain/portfolio/types";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_OPTIONS, isExpenseCategory } from "@/domain/portfolio/categories";
import { chatWithLocalLlm, type LocalLlmChatMessage, type LocalLlmResult } from "@/lib/llm/local-llm-client";

export type CategorizableTransaction = {
  description: string;
  merchant: string | null;
  direction: TransactionDirection;
  amount: number;
  // Category the deterministic parser already assigned; kept as the fallback
  // whenever the model is unavailable or does not answer for this row.
  category: ExpenseCategory;
};

export type LlmChatFn = (messages: LocalLlmChatMessage[], options?: { numPredict?: number; timeoutMs?: number; format?: "json" }) => Promise<LocalLlmResult>;

// Enough transactions per request to keep the number of round trips low, but
// small enough that prompt plus JSON reply stay inside the local model's window.
const BATCH_SIZE = 20;
const CATEGORIZER_TIMEOUT_MS = 120_000;
const MAX_MERCHANT_CHARS = 60;

// Maps both the canonical key ("food") and the Polish UI label ("jedzenie")
// back to the category, so either shape from the model is accepted.
const LABEL_TO_CATEGORY = new Map<string, ExpenseCategory>([
  ...EXPENSE_CATEGORIES.map((category) => [category, category] as const),
  ...EXPENSE_CATEGORY_OPTIONS.map((option) => [option.label.toLowerCase(), option.value] as const)
]);

function transactionLabel(transaction: CategorizableTransaction) {
  const merchant = (transaction.merchant ?? transaction.description).replace(/\s+/g, " ").trim().slice(0, MAX_MERCHANT_CHARS);
  const flow = transaction.direction === "INFLOW" ? "WPŁYW" : "WYDATEK";
  return `${flow} ${transaction.amount.toFixed(2)} PLN: ${merchant}`;
}

function buildMessages(batch: CategorizableTransaction[]): LocalLlmChatMessage[] {
  const catalogue = EXPENSE_CATEGORY_OPTIONS.map((option) => `${option.value} (${option.label})`).join(", ");
  const system: LocalLlmChatMessage = {
    role: "system",
    content: [
      "Jesteś klasyfikatorem transakcji bankowych mBank. Dla każdej transakcji wybierz dokładnie jeden klucz kategorii z listy.",
      `Dozwolone klucze: ${catalogue}.`,
      "Reguły (stosuj dokładnie):",
      "- Przelew do/od osoby prywatnej (imię i nazwisko, np. JAN KOWALSKI), niezależnie od kierunku = people_transfers.",
      "- Wynagrodzenie, wpływ od firmy, zwrot podatku = income.",
      "- Sklepy spożywcze (Biedronka, Lidl, Kaufland, Auchan, Żabka, Dino) i gastronomia (restauracja, pizza, McDonald's, piekarnia, lodziarnia) = food.",
      "- Paliwo (Orlen, Shell, BP, Circle K), bilety i przejazdy (PKP, Koleo, Uber, Bolt, JakDojade), parkingi = transport.",
      "- Serwisy abonamentowe (Netflix, Spotify, Prime Video, Disney, Apple, OpenAI, Google Cloud) = subscriptions.",
      "- Sklepy internetowe i detaliczne (Allegro, Amazon, Rossmann, Zalando, Booking, hotele) = shopping.",
      "- Apteka, lekarz, przychodnia, fryzjer, kosmetyka = health.",
      "- Prowizje, opłaty bankowe, ubezpieczenia = fees. Gdy naprawdę nie wiadomo = other.",
      'Odpowiedz WYŁĄCZNIE poprawnym JSON: {"items":[{"i":1,"kategoria":"food"}, ...]} dla każdego numeru z wejścia.'
    ].join("\n")
  };

  const user: LocalLlmChatMessage = {
    role: "user",
    content: batch.map((transaction, index) => `${index + 1}. ${transactionLabel(transaction)}`).join("\n")
  };

  return [system, user];
}

function parseCategoryResponse(content: string, batchSize: number): Array<ExpenseCategory | null> {
  const result: Array<ExpenseCategory | null> = new Array(batchSize).fill(null);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Some models wrap the JSON in prose or code fences; grab the first object.
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      return result;
    }
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return result;
    }
  }

  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: unknown[] }).items
      : [];

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as { i?: unknown; kategoria?: unknown; category?: unknown };
    const index = Number(record.i);
    const rawCategory = String(record.kategoria ?? record.category ?? "").toLowerCase().trim();
    const category = isExpenseCategory(rawCategory) ? rawCategory : LABEL_TO_CATEGORY.get(rawCategory) ?? null;

    if (Number.isInteger(index) && index >= 1 && index <= batchSize && category) {
      result[index - 1] = category;
    }
  }

  return result;
}

export type CategorizeOptions = {
  chat?: LlmChatFn;
  model?: string;
};

/**
 * Assigns an expense category to each transaction using the local LLM, batched
 * to keep prompts small. Each transaction's existing parser category is the
 * per-item fallback used whenever the model is unavailable, returns invalid
 * JSON, or omits a row - so categorization never fails the import.
 */
export async function categorizeTransactionsWithLlm(
  transactions: CategorizableTransaction[],
  options: CategorizeOptions = {}
): Promise<ExpenseCategory[]> {
  const categories = transactions.map((transaction) => transaction.category);

  if (transactions.length === 0) {
    return categories;
  }

  const chat = options.chat ?? ((messages, chatOptions) => chatWithLocalLlm(messages, { ...chatOptions, model: options.model }));

  for (let start = 0; start < transactions.length; start += BATCH_SIZE) {
    const batch = transactions.slice(start, start + BATCH_SIZE);

    try {
      const response = await chat(buildMessages(batch), {
        timeoutMs: CATEGORIZER_TIMEOUT_MS,
        numPredict: Math.min(40 + batch.length * 12, 600),
        format: "json"
      });

      if (!response.success) {
        continue;
      }

      const resolved = parseCategoryResponse(response.content, batch.length);
      resolved.forEach((category, offset) => {
        if (category) {
          categories[start + offset] = category;
        }
      });
    } catch {
      // Keep the deterministic seed categories for this batch on any failure.
    }
  }

  return categories;
}
