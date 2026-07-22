import { Prisma, type BankTransaction, type ImportBatch, type MbankSyncMode, type PrismaClient } from "@prisma/client";
import {
  readGmailMessage,
  readGmailPdfAttachments,
  searchMbankMessages,
  type GmailMessageBody,
  type GmailMessageSummary,
  type GmailPdfAttachment
} from "./gmail-mcp-adapter";
import { MbankParseError, parseMbankEmail, type ParsedMbankTransaction } from "./mbank-parser";
import { MbankStatementParseError, parseMbankStatementPdf, type ParsedMbankStatement } from "./mbank-statement-parser";
import { categorizeTransactionsWithLlm, type CategorizableTransaction } from "./llm-categorizer";
import { EXPENSE_CATEGORIES, isExpenseCategory } from "@/domain/portfolio/categories";
import { recordTraceWarning, traceStep } from "@/domain/tracing/local-tracing";
import { mbankSyncModeLabel } from "./mbank-sync-mode";
import { categorySourceOrDefault, normalizeMerchantKey, ruleMapKey, type CategorySource } from "./category-rules";
import type { TransactionDirection } from "@/domain/portfolio/types";

const RESOURCE_ID = "local-user";

// mBank titles the monthly statement email "elektroniczne zestawienie operacji za <month> <year>".
const STATEMENT_SUBJECT_RE = /elektroniczne zestawienie operacji/i;

function statementPasswordFromEnv() {
  return (process.env.MBANK_STATEMENT_PDF_PASSWORD ?? "").replace(/^"|"$/g, "") || undefined;
}

type GmailAdapter = {
  searchMbankMessages: () => Promise<GmailMessageSummary[]>;
  readGmailMessage: (message: GmailMessageSummary) => Promise<GmailMessageBody>;
  readGmailPdfAttachments?: (message: GmailMessageSummary) => Promise<GmailPdfAttachment[]>;
};

// Assigns a category to each parsed transaction. Defaults to the local LLM
// (with a deterministic keyword fallback); injectable so tests stay offline.
export type CategorizeTransactions = (transactions: CategorizableTransaction[]) => Promise<ParsedMbankTransaction["category"][]>;

function toCategorizable(transaction: ParsedMbankTransaction): CategorizableTransaction {
  return {
    description: transaction.description,
    merchant: transaction.merchant,
    direction: transaction.direction,
    amount: transaction.amount,
    category: transaction.category
  };
}

type RuleMatch = { category: string; ruleId: string };

// Loads this resource's learned rules once into a Map keyed on
// `matchKey|direction`, so the categorize step can look each row up in O(1).
async function loadCategoryRuleMap(db: PrismaClient, resourceId: string): Promise<Map<string, RuleMatch>> {
  const rules = await db.categoryRule.findMany({ where: { resourceId } });
  const map = new Map<string, RuleMatch>();

  for (const rule of rules) {
    map.set(ruleMapKey(rule.matchKey, rule.direction), { category: rule.category, ruleId: rule.id });
  }

  return map;
}

/**
 * Categorizes parsed transactions with the learned-rule pass in front of the
 * LLM. A row whose normalized merchant plus direction matches a rule takes the
 * rule's category (`categorySource = "learned"`), bumps the rule's hit count,
 * and is excluded from the LLM batch. Remaining rows go to `categorize` exactly
 * as before, so the "never fail an import" per-item fallback is preserved; a row
 * the model moved off its deterministic seed is `"llm"`, an unanswered/fallback
 * row stays `"deterministic"`. Applied on fresh imports and preview rebuilds.
 */
async function categorizeParsed<T extends { transactions: ParsedMbankTransaction[] }>(
  db: PrismaClient,
  parsed: T,
  categorize: CategorizeTransactions
): Promise<T> {
  if (parsed.transactions.length === 0) {
    return parsed;
  }

  const ruleMap = await loadCategoryRuleMap(db, RESOURCE_ID);

  const learnedCategoryByIndex = new Map<number, string>();
  const ruleHitCounts = new Map<string, number>();
  const llmIndexes: number[] = [];

  parsed.transactions.forEach((transaction, index) => {
    const key = normalizeMerchantKey(transaction.merchant);
    const match = key ? ruleMap.get(ruleMapKey(key, transaction.direction)) : undefined;

    if (match && isExpenseCategory(match.category)) {
      learnedCategoryByIndex.set(index, match.category);
      ruleHitCounts.set(match.ruleId, (ruleHitCounts.get(match.ruleId) ?? 0) + 1);
    } else {
      llmIndexes.push(index);
    }
  });

  const llmCategories =
    llmIndexes.length > 0 ? await categorize(llmIndexes.map((index) => toCategorizable(parsed.transactions[index]!))) : [];
  const llmCategoryByIndex = new Map<number, string>();
  llmIndexes.forEach((originalIndex, offset) => {
    llmCategoryByIndex.set(originalIndex, llmCategories[offset] ?? parsed.transactions[originalIndex]!.category);
  });

  const transactions = parsed.transactions.map((transaction, index) => {
    const learned = learnedCategoryByIndex.get(index);
    if (learned) {
      return { ...transaction, category: learned, categorySource: "learned" satisfies CategorySource as string };
    }

    const resolved = llmCategoryByIndex.get(index) ?? transaction.category;
    const source: CategorySource = resolved === transaction.category ? "deterministic" : "llm";
    return { ...transaction, category: resolved, categorySource: source as string };
  });

  // One update per matched rule; hit counts drive future auditing only.
  for (const [ruleId, count] of ruleHitCounts) {
    await db.categoryRule.update({ where: { id: ruleId }, data: { hitCount: { increment: count } } });
  }

  return { ...parsed, transactions };
}

// Learns (creates or last-write-wins updates) a rule from a user correction.
// A null/weak key means the correction is still saved, it just teaches nothing.
async function learnCategoryRule(
  db: PrismaClient | Prisma.TransactionClient,
  input: { merchant: string | null; direction: TransactionDirection; category: string }
): Promise<void> {
  const matchKey = normalizeMerchantKey(input.merchant);
  if (!matchKey || !isExpenseCategory(input.category)) {
    return;
  }

  await db.categoryRule.upsert({
    where: { resourceId_matchKey_direction: { resourceId: RESOURCE_ID, matchKey, direction: input.direction } },
    create: { resourceId: RESOURCE_ID, matchKey, direction: input.direction, category: input.category },
    update: { category: input.category }
  });
}

export type MbankImportSyncResult = {
  status: "unavailable" | "no_new_messages" | "completed";
  message: string;
  created: number;
  duplicates: number;
  failed: number;
  skipped: number;
};

export type MbankRetryParseResult = {
  status: "pending_review" | "duplicate" | "failed";
  batch: ImportBatch;
  transactionCount: number;
  message: string;
};

type ImportPreviewReviewStatus = "PENDING" | "ACCEPTED" | "REJECTED";

type StoredParsedTransaction = {
  operationDate: string;
  bookingDate?: string | null;
  amount: number;
  currency: string;
  direction: "INFLOW" | "OUTFLOW";
  description: string;
  merchant: string | null;
  category: string;
  categorySource?: string;
  reviewStatus?: ImportPreviewReviewStatus;
  included?: boolean;
  accountLabel?: string | null;
  balanceAfter?: number | null;
};

export function createImportDedupeKey(input: { provider: string; gmailMessageId: string; operationDate: Date }) {
  return `${input.provider}:${input.gmailMessageId}:${input.operationDate.toISOString().slice(0, 10)}`;
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Unknown mBank import error.";
}

function isNonTransactionMbankEmail(error: unknown) {
  return error instanceof MbankParseError && /could not find transaction rows/i.test(error.message);
}

function toStoredTransaction(transaction: ParsedMbankTransaction): StoredParsedTransaction {
  return {
    operationDate: transaction.operationDate.toISOString(),
    bookingDate: transaction.bookingDate ? transaction.bookingDate.toISOString() : null,
    amount: transaction.amount,
    currency: transaction.currency,
    direction: transaction.direction,
    description: transaction.description,
    merchant: transaction.merchant,
    category: transaction.category,
    categorySource: categorySourceOrDefault(transaction.categorySource),
    reviewStatus: "PENDING",
    accountLabel: transaction.accountLabel ?? null,
    balanceAfter: transaction.balanceAfter ?? null
  };
}

function storedTransactions(value: Prisma.JsonValue | null | undefined): StoredParsedTransaction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const transactions = value.filter((item): item is StoredParsedTransaction => {
    const candidate = item as Partial<StoredParsedTransaction>;
    return (
      typeof candidate.operationDate === "string" &&
      typeof candidate.amount === "number" &&
      (candidate.direction === "INFLOW" || candidate.direction === "OUTFLOW") &&
      typeof candidate.description === "string" &&
      typeof candidate.category === "string"
    );
  });

  return transactions.map((transaction) => ({
    ...transaction,
    categorySource: categorySourceOrDefault(transaction.categorySource),
    reviewStatus:
      transaction.reviewStatus === "ACCEPTED" || transaction.reviewStatus === "REJECTED" || transaction.reviewStatus === "PENDING"
        ? transaction.reviewStatus
        : transaction.included === false
          ? "REJECTED"
          : "PENDING"
  }));
}

function assertSupportedCategory(category: string) {
  if (!isExpenseCategory(category)) {
    throw new Error(`Unsupported transaction category "${category}". Allowed categories: ${EXPENSE_CATEGORIES.join(", ")}.`);
  }

  return category;
}

async function findExactBatch(db: PrismaClient, messageId: string, operationDate: Date, exceptBatchId?: string) {
  return db.importBatch.findFirst({
    where: {
      provider: "MBANK_EMAIL",
      gmailMessageId: messageId,
      operationDate,
      ...(exceptBatchId ? { NOT: { id: exceptBatchId } } : {})
    }
  });
}

async function createSkippedBatch(db: PrismaClient, message: GmailMessageSummary, error: unknown) {
  const errorMessage = safeErrorMessage(error);
  const existing = await db.importBatch.findFirst({
    where: {
      provider: "MBANK_EMAIL",
      gmailMessageId: message.id,
      operationDate: null
    },
    orderBy: { createdAt: "desc" }
  });

  const data = {
    gmailThreadId: message.threadId ?? null,
    subject: message.subject ?? null,
    sender: message.sender ?? null,
    receivedAt: message.receivedAt ?? null,
    status: "SKIPPED" as const,
    transactionCount: 0,
    parsedTransactions: Prisma.DbNull,
    errorMessage: `Skipped non-transaction mBank email: ${errorMessage}`
  };

  if (existing) {
    return db.importBatch.update({
      where: { id: existing.id },
      data
    });
  }

  return db.importBatch.create({
    data: {
      provider: "MBANK_EMAIL",
      source: "GMAIL_MCP",
      gmailMessageId: message.id,
      ...data
    }
  });
}

async function createFailedBatch(db: PrismaClient, message: GmailMessageSummary, error: unknown) {
  const errorMessage = safeErrorMessage(error);
  const provider = isStatementMessage(message) ? "MBANK_STATEMENT" : "MBANK_EMAIL";
  const existing = await db.importBatch.findFirst({
    where: {
      provider,
      gmailMessageId: message.id,
      operationDate: null
    },
    orderBy: { createdAt: "desc" }
  });

  if (existing) {
    return db.importBatch.update({
      where: { id: existing.id },
      data: {
        gmailThreadId: message.threadId ?? null,
        subject: message.subject ?? null,
        sender: message.sender ?? null,
        receivedAt: message.receivedAt ?? null,
        status: "FAILED",
        transactionCount: 0,
        parsedTransactions: Prisma.DbNull,
        errorMessage
      }
    });
  }

  return db.importBatch.create({
    data: {
      provider,
      source: "GMAIL_MCP",
      gmailMessageId: message.id,
      gmailThreadId: message.threadId ?? null,
      subject: message.subject ?? null,
      sender: message.sender ?? null,
      receivedAt: message.receivedAt ?? null,
      status: "FAILED",
      transactionCount: 0,
      parsedTransactions: Prisma.DbNull,
      errorMessage
    }
  });
}

async function createPendingBatch(db: PrismaClient, message: GmailMessageBody, parsed: ReturnType<typeof parseMbankEmail>) {
  const parsedTransactions = parsed.transactions.map(toStoredTransaction);
  const existing = await findExactBatch(db, message.id, parsed.operationDate);

  if (existing) {
    return { created: false as const, batch: existing };
  }

  const staleFailedBatch = await db.importBatch.findFirst({
    where: {
      provider: "MBANK_EMAIL",
      gmailMessageId: message.id,
      operationDate: null,
      status: { in: ["FAILED", "SKIPPED"] }
    },
    orderBy: { createdAt: "desc" }
  });

  if (staleFailedBatch) {
    const batch = await db.importBatch.update({
      where: { id: staleFailedBatch.id },
      data: {
        gmailThreadId: message.threadId ?? null,
        subject: message.subject ?? null,
        sender: message.sender ?? null,
        operationDate: parsed.operationDate,
        receivedAt: message.receivedAt ?? null,
        status: "PENDING_REVIEW",
        transactionCount: parsed.transactions.length,
        parsedTransactions,
        errorMessage: null
      }
    });

    return { created: true as const, batch };
  }

  const batch = await db.importBatch.create({
    data: {
      provider: "MBANK_EMAIL",
      source: "GMAIL_MCP",
      gmailMessageId: message.id,
      gmailThreadId: message.threadId ?? null,
      subject: message.subject ?? null,
      sender: message.sender ?? null,
      operationDate: parsed.operationDate,
      receivedAt: message.receivedAt ?? null,
      status: "PENDING_REVIEW",
      transactionCount: parsed.transactions.length,
      parsedTransactions
    }
  });

  return { created: true as const, batch };
}

async function createPendingStatementBatch(db: PrismaClient, message: GmailMessageBody, parsed: ParsedMbankStatement) {
  const parsedTransactions = parsed.transactions.map(toStoredTransaction);
  // The statement period end doubles as the batch operationDate so the existing
  // (provider, gmailMessageId, operationDate) dedupe key stays meaningful.
  const existing = await db.importBatch.findFirst({
    where: { provider: "MBANK_STATEMENT", gmailMessageId: message.id, operationDate: parsed.periodEnd }
  });

  if (existing) {
    return { created: false as const, batch: existing };
  }

  const batch = await db.importBatch.create({
    data: {
      provider: "MBANK_STATEMENT",
      source: "GMAIL_MCP",
      gmailMessageId: message.id,
      gmailThreadId: message.threadId ?? null,
      subject: message.subject ?? null,
      sender: message.sender ?? null,
      operationDate: parsed.periodEnd,
      receivedAt: message.receivedAt ?? null,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      status: "PENDING_REVIEW",
      transactionCount: parsed.transactions.length,
      parsedTransactions
    }
  });

  return { created: true as const, batch };
}

function isStatementMessage(message: Pick<GmailMessageBody, "subject">) {
  return STATEMENT_SUBJECT_RE.test(message.subject ?? "");
}

async function isCoveredByImportedStatement(db: PrismaClient, date: Date) {
  const covering = await db.importBatch.findFirst({
    where: {
      provider: "MBANK_STATEMENT",
      status: "IMPORTED",
      periodStart: { lte: date },
      periodEnd: { gte: date }
    }
  });

  return covering !== null;
}

async function processStatementMessage(
  db: PrismaClient,
  message: GmailMessageBody,
  adapter: Pick<GmailAdapter, "readGmailPdfAttachments">,
  traceId: string,
  password: string | undefined,
  categorize: CategorizeTransactions
) {
  const readPdfAttachments = adapter.readGmailPdfAttachments;

  if (!readPdfAttachments) {
    throw new MbankStatementParseError("This Gmail adapter cannot read PDF attachments, so mBank statements cannot be imported.");
  }

  const attachments = await traceStep(db, { traceId, resourceId: RESOURCE_ID, name: "gmail-sync.statement-pdf", input: { id: message.id } }, () =>
    readPdfAttachments(message)
  );
  const pdf = attachments.find((attachment) => (attachment.filename ?? "").toLowerCase().endsWith(".pdf")) ?? attachments[0];

  if (!pdf) {
    throw new MbankStatementParseError("mBank statement email has no PDF attachment to parse.");
  }

  const parsed = await traceStep(db, { traceId, resourceId: RESOURCE_ID, name: "mbank-statement-parser", input: { id: message.id } }, () =>
    parseMbankStatementPdf(pdf.data, password)
  );
  const categorized = await traceStep(db, { traceId, resourceId: RESOURCE_ID, name: "llm-categorizer", input: { id: message.id, count: parsed.transactions.length } }, () =>
    categorizeParsed(db, parsed, categorize)
  );

  return traceStep(db, { traceId, resourceId: RESOURCE_ID, name: "import-preview", input: { id: message.id } }, () =>
    createPendingStatementBatch(db, message, categorized)
  );
}

function shouldProcessForSyncMode(message: Pick<GmailMessageBody, "subject">, syncMode: MbankSyncMode) {
  if (syncMode === "BOTH") {
    return true;
  }

  return isStatementMessage(message) === (syncMode === "STATEMENT_ONLY");
}

export async function syncMbankGmail(
  db: PrismaClient,
  options: { adapter?: GmailAdapter; traceId?: string; statementPassword?: string; categorize?: CategorizeTransactions; syncMode?: MbankSyncMode } = {}
): Promise<MbankImportSyncResult> {
  const adapter = options.adapter ?? { searchMbankMessages, readGmailMessage, readGmailPdfAttachments };
  const traceId = options.traceId ?? `gmail-sync-${Date.now()}`;
  const statementPassword = options.statementPassword ?? statementPasswordFromEnv();
  const categorize = options.categorize ?? ((transactions) => categorizeTransactionsWithLlm(transactions));
  const syncMode = options.syncMode ?? "BOTH";
  const syncModeLabel = mbankSyncModeLabel(syncMode);

  let messages: GmailMessageSummary[];

  try {
    messages = await traceStep(db, { traceId, resourceId: RESOURCE_ID, name: "gmail-sync.search" }, () => adapter.searchMbankMessages());
  } catch (error) {
    await recordTraceWarning(db, {
      traceId,
      resourceId: RESOURCE_ID,
      name: "gmail-sync.unavailable",
      message: safeErrorMessage(error)
    });
    return {
      status: "unavailable",
      message: safeErrorMessage(error),
      created: 0,
      duplicates: 0,
      failed: 0,
      skipped: 0
    };
  }

  if (messages.length === 0) {
    return {
      status: "no_new_messages",
      message: `${syncModeLabel}: no new mBank Gmail messages found.`,
      created: 0,
      duplicates: 0,
      failed: 0,
      skipped: 0
    };
  }

  let created = 0;
  let duplicates = 0;
  let failed = 0;
  let skipped = 0;
  let matchingMessages = 0;

  for (const message of messages) {
    let classifiedMessage = message;

    try {
      const fullMessage = await traceStep(db, { traceId, resourceId: RESOURCE_ID, name: "gmail-sync.read", input: { id: message.id } }, () =>
        adapter.readGmailMessage(message)
      );
      classifiedMessage = fullMessage;

      // Gmail REST list results contain IDs only. Classify after messages.get so
      // statement-only mode does not discard statements whose summary has no subject.
      if (!shouldProcessForSyncMode(fullMessage, syncMode)) {
        continue;
      }

      matchingMessages += 1;

      const result = isStatementMessage(fullMessage)
        ? await processStatementMessage(db, fullMessage, adapter, traceId, statementPassword, categorize)
        : await (async () => {
            const parsed = await traceStep(db, { traceId, resourceId: RESOURCE_ID, name: "mbank-parser", input: { id: message.id } }, () =>
              parseMbankEmail(fullMessage.bodyText)
            );

            // A confirmed monthly statement already owns this day, so the daily
            // notification is redundant and should not clutter the review queue.
            if (await isCoveredByImportedStatement(db, parsed.operationDate)) {
              return { created: false as const, batch: null, covered: true as const };
            }

            const categorized = await traceStep(db, { traceId, resourceId: RESOURCE_ID, name: "llm-categorizer", input: { id: message.id, count: parsed.transactions.length } }, () =>
              categorizeParsed(db, parsed, categorize)
            );

            return traceStep(db, { traceId, resourceId: RESOURCE_ID, name: "import-preview", input: { id: message.id } }, () =>
              createPendingBatch(db, fullMessage, categorized)
            );
          })();

      if ("covered" in result && result.covered) {
        duplicates += 1;
      } else if (result.created) {
        created += 1;
      } else {
        duplicates += 1;
      }
    } catch (error) {
      if (isNonTransactionMbankEmail(error)) {
        skipped += 1;
        await createSkippedBatch(db, classifiedMessage, error);
        await recordTraceWarning(db, {
          traceId,
          resourceId: RESOURCE_ID,
          name: "gmail-sync.message-skipped",
          input: { id: message.id },
          message: safeErrorMessage(error)
        });
        continue;
      }

      failed += 1;
      await createFailedBatch(db, classifiedMessage, error);
      await recordTraceWarning(db, {
        traceId,
        resourceId: RESOURCE_ID,
        name: "gmail-sync.message-failed",
        input: { id: message.id },
        message: safeErrorMessage(error)
      });
    }
  }

  if (matchingMessages === 0 && failed === 0) {
    return {
      status: "no_new_messages",
      message: `${syncModeLabel}: no matching mBank Gmail messages found in the current search window.`,
      created: 0,
      duplicates: 0,
      failed: 0,
      skipped: 0
    };
  }

  return {
    status: "completed",
    message: `${syncModeLabel}: prepared ${created} import preview(s), skipped ${duplicates} duplicate(s), skipped ${skipped} non-transaction email(s), failed ${failed}.`,
    created,
    duplicates,
    failed,
    skipped
  };
}

export async function retryParseImportBatch(
  db: PrismaClient,
  batchId: string,
  options: { adapter?: Pick<GmailAdapter, "readGmailMessage" | "readGmailPdfAttachments">; traceId?: string; statementPassword?: string; categorize?: CategorizeTransactions } = {}
): Promise<MbankRetryParseResult> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });

  if (!batch) {
    throw new Error("Import batch not found.");
  }

  if (!["FAILED", "PENDING_REVIEW", "SKIPPED"].includes(batch.status)) {
    throw new Error(`Import batch cannot be retried from status ${batch.status}.`);
  }

  const adapter = options.adapter ?? { readGmailMessage, readGmailPdfAttachments };
  const traceId = options.traceId ?? `gmail-retry-${batch.id}-${Date.now()}`;
  const statementPassword = options.statementPassword ?? statementPasswordFromEnv();
  const categorize = options.categorize ?? ((transactions) => categorizeTransactionsWithLlm(transactions));
  const summary: GmailMessageSummary = {
    id: batch.gmailMessageId,
    threadId: batch.gmailThreadId,
    subject: batch.subject,
    sender: batch.sender,
    receivedAt: batch.receivedAt,
    snippet: null
  };

  try {
    const fullMessage = await traceStep(db, { traceId, resourceId: RESOURCE_ID, name: "gmail-retry.read", input: { id: summary.id } }, () =>
      adapter.readGmailMessage(summary)
    );

    if (batch.provider === "MBANK_STATEMENT" || isStatementMessage(fullMessage)) {
      if (!adapter.readGmailPdfAttachments) {
        throw new MbankStatementParseError("This Gmail adapter cannot read PDF attachments, so mBank statements cannot be imported.");
      }

      const attachments = await traceStep(db, { traceId, resourceId: RESOURCE_ID, name: "gmail-retry.statement-pdf", input: { id: summary.id } }, () =>
        adapter.readGmailPdfAttachments!(fullMessage)
      );
      const pdf = attachments.find((attachment) => (attachment.filename ?? "").toLowerCase().endsWith(".pdf")) ?? attachments[0];

      if (!pdf) {
        throw new MbankStatementParseError("mBank statement email has no PDF attachment to parse.");
      }

      const parsed = await traceStep(db, { traceId, resourceId: RESOURCE_ID, name: "gmail-retry.statement-parser", input: { id: summary.id } }, () =>
        parseMbankStatementPdf(pdf.data, statementPassword)
      );
      const categorized = await traceStep(
        db,
        { traceId, resourceId: RESOURCE_ID, name: "gmail-retry.categorizer", input: { id: summary.id, count: parsed.transactions.length } },
        () => categorizeParsed(db, parsed, categorize)
      );
      const parsedTransactions = categorized.transactions.map(toStoredTransaction);

      const duplicate = await db.importBatch.findFirst({
        where: { provider: "MBANK_STATEMENT", gmailMessageId: fullMessage.id, operationDate: categorized.periodEnd, NOT: { id: batch.id } }
      });

      const updated = await db.importBatch.update({
        where: { id: batch.id },
        data: {
          provider: "MBANK_STATEMENT",
          gmailThreadId: fullMessage.threadId ?? null,
          subject: fullMessage.subject ?? batch.subject,
          sender: fullMessage.sender ?? batch.sender,
          operationDate: categorized.periodEnd,
          receivedAt: fullMessage.receivedAt ?? batch.receivedAt,
          periodStart: categorized.periodStart,
          periodEnd: categorized.periodEnd,
          status: duplicate ? "DUPLICATE" : "PENDING_REVIEW",
          transactionCount: categorized.transactions.length,
          parsedTransactions,
          errorMessage: duplicate ? `Duplicate of import batch ${duplicate.id}.` : null
        }
      });

      return duplicate
        ? {
            status: "duplicate",
            batch: updated,
            transactionCount: categorized.transactions.length,
            message: `Parsed successfully, but batch ${duplicate.id} already covers this statement period.`
          }
        : {
            status: "pending_review",
            batch: updated,
            transactionCount: categorized.transactions.length,
            message: `Retry parsed ${categorized.transactions.length} transaction(s). Review and confirm to import.`
          };
    }

    const parsed = await traceStep(db, { traceId, resourceId: RESOURCE_ID, name: "gmail-retry.parser", input: { id: summary.id } }, () =>
      parseMbankEmail(fullMessage.bodyText)
    );
    // Rebuilding a pending email preview categorizes like a fresh import, so
    // learned rules apply and the preview shows the "learned" flag on retry too.
    const categorized = await traceStep(
      db,
      { traceId, resourceId: RESOURCE_ID, name: "gmail-retry.categorizer", input: { id: summary.id, count: parsed.transactions.length } },
      () => categorizeParsed(db, parsed, categorize)
    );
    const parsedTransactions = categorized.transactions.map(toStoredTransaction);
    const duplicate = await findExactBatch(db, fullMessage.id, parsed.operationDate, batch.id);

    if (duplicate) {
      const updated = await db.importBatch.update({
        where: { id: batch.id },
        data: {
          gmailThreadId: fullMessage.threadId ?? null,
          subject: fullMessage.subject ?? batch.subject,
          sender: fullMessage.sender ?? batch.sender,
          operationDate: parsed.operationDate,
          receivedAt: fullMessage.receivedAt ?? batch.receivedAt,
          status: "DUPLICATE",
          transactionCount: parsed.transactions.length,
          parsedTransactions,
          errorMessage: `Duplicate of import batch ${duplicate.id}.`
        }
      });

      return {
        status: "duplicate",
        batch: updated,
        transactionCount: parsed.transactions.length,
        message: `Parsed successfully, but batch ${duplicate.id} already covers this Gmail message and operation date.`
      };
    }

    const updated = await db.importBatch.update({
      where: { id: batch.id },
      data: {
        gmailThreadId: fullMessage.threadId ?? null,
        subject: fullMessage.subject ?? batch.subject,
        sender: fullMessage.sender ?? batch.sender,
        operationDate: parsed.operationDate,
        receivedAt: fullMessage.receivedAt ?? batch.receivedAt,
        status: "PENDING_REVIEW",
        transactionCount: parsed.transactions.length,
        parsedTransactions,
        errorMessage: null
      }
    });

    return {
      status: "pending_review",
      batch: updated,
      transactionCount: parsed.transactions.length,
      message: `Retry parsed ${parsed.transactions.length} transaction(s). Review and confirm to import.`
    };
  } catch (error) {
    const updated = await db.importBatch.update({
      where: { id: batch.id },
      data: {
        status: "FAILED",
        transactionCount: 0,
        parsedTransactions: Prisma.DbNull,
        errorMessage: safeErrorMessage(error)
      }
    });

    await recordTraceWarning(db, {
      traceId,
      resourceId: RESOURCE_ID,
      name: "gmail-retry.failed",
      input: { id: summary.id },
      message: safeErrorMessage(error)
    });

    return {
      status: "failed",
      batch: updated,
      transactionCount: 0,
      message: safeErrorMessage(error)
    };
  }
}

export async function updateImportPreviewTransactionCategory(
  db: PrismaClient,
  batchId: string,
  transactionIndex: number,
  category: string
): Promise<ImportBatch> {
  const nextCategory = assertSupportedCategory(category);

  if (!Number.isInteger(transactionIndex) || transactionIndex < 0) {
    throw new Error("Invalid import preview transaction index.");
  }

  return db.$transaction(async (tx) => {
    const existing = await tx.importBatch.findUnique({ where: { id: batchId } });
    if (!existing) {
      throw new Error("Import batch not found.");
    }

    // Updating the row first serializes category changes with review decisions.
    const batch = await tx.importBatch.update({ where: { id: batchId }, data: { updatedAt: new Date() } });
    if (batch.status !== "PENDING_REVIEW") {
      throw new Error(`Import batch category cannot be changed from status ${batch.status}.`);
    }

    const parsed = storedTransactions(batch.parsedTransactions);
    const transaction = parsed[transactionIndex];
    if (!transaction) {
      throw new Error("Import preview transaction not found.");
    }

    // An explicit correction is provenance "user" and overrides any learned flag.
    const parsedTransactions = parsed.map((item, index) =>
      index === transactionIndex ? { ...item, category: nextCategory, categorySource: "user" satisfies CategorySource as string } : item
    );
    const updatedBatch = await tx.importBatch.update({
      where: { id: batch.id },
      data: { parsedTransactions: parsedTransactions as Prisma.InputJsonValue }
    });

    if (transaction.reviewStatus === "ACCEPTED") {
      const [acceptedRow] = transactionRows(batch, [{ ...transaction, category: nextCategory }]);
      const linkedTransactions = await tx.bankTransaction.findMany({ where: { importBatchId: batch.id } });

      for (const linked of linkedTransactions) {
        if (acceptedRow && transactionIdentity(linked) === transactionIdentity(acceptedRow)) {
          await tx.bankTransaction.update({ where: { id: linked.id }, data: { category: nextCategory, categorySource: "user" } });
        }
      }
    }

    // Teach a rule from this correction (skips null/weak keys). Same tx as the
    // write above, so a learned rule and its trigger commit together.
    await learnCategoryRule(tx, { merchant: transaction.merchant, direction: transaction.direction, category: nextCategory });

    return updatedBatch;
  });
}

export async function updateImportPreviewTransactionReview(
  db: PrismaClient,
  batchId: string,
  transactionIndex: number,
  reviewStatus: Exclude<ImportPreviewReviewStatus, "PENDING">
): Promise<ImportBatch> {
  if (!Number.isInteger(transactionIndex) || transactionIndex < 0) {
    throw new Error("Invalid import preview transaction index.");
  }

  return db.$transaction(async (tx) => {
    const existing = await tx.importBatch.findUnique({ where: { id: batchId } });
    if (!existing) {
      throw new Error("Import batch not found.");
    }

    // This update takes a row lock so concurrent double submissions are processed in order.
    const batch = await tx.importBatch.update({ where: { id: batchId }, data: { updatedAt: new Date() } });
    if (batch.status !== "PENDING_REVIEW") {
      throw new Error(`Import preview cannot be changed from status ${batch.status}.`);
    }

    const parsed = storedTransactions(batch.parsedTransactions);
    const reviewedTransaction = parsed[transactionIndex];
    if (!reviewedTransaction) {
      throw new Error("Import preview transaction not found.");
    }

    if (reviewedTransaction.reviewStatus !== "PENDING" && reviewedTransaction.reviewStatus !== reviewStatus) {
      throw new Error("Import preview transaction has already been reviewed.");
    }

    const parsedTransactions = parsed.map((transaction, index) =>
      index === transactionIndex ? { ...transaction, reviewStatus } : transaction
    );
    const materialized = await materializeAcceptedTransactions(tx, batch, parsedTransactions);
    const pendingCount = parsedTransactions.filter((transaction) => transaction.reviewStatus === "PENDING").length;
    const acceptedCount = parsedTransactions.filter((transaction) => transaction.reviewStatus === "ACCEPTED").length;
    const status = pendingCount > 0 ? "PENDING_REVIEW" : acceptedCount > 0 ? "IMPORTED" : "SKIPPED";

    return tx.importBatch.update({
      where: { id: batch.id },
      data: {
        parsedTransactions: parsedTransactions as Prisma.InputJsonValue,
        status,
        transactionCount: status === "PENDING_REVIEW" ? batch.transactionCount : materialized.created
      }
    });
  });
}

export async function updateBankTransactionCategory(
  db: PrismaClient,
  transactionId: string,
  category: string
): Promise<BankTransaction> {
  const nextCategory = assertSupportedCategory(category);

  // The update returns the row, so `merchant` + `direction` are read back for the
  // rule key without a second query. An explicit correction is provenance "user".
  const updated = await db.bankTransaction.update({
    where: { id: transactionId },
    data: { category: nextCategory, categorySource: "user" }
  });

  await learnCategoryRule(db, { merchant: updated.merchant, direction: updated.direction, category: nextCategory });

  return updated;
}

function transactionRows(batch: ImportBatch, parsed: StoredParsedTransaction[]) {
  const source = batch.provider === "MBANK_STATEMENT" ? ("STATEMENT" as const) : ("EMAIL" as const);

  return parsed
    .filter((transaction) => transaction.reviewStatus === "ACCEPTED")
    .map((transaction) => ({
      importBatchId: batch.id,
      provider: "MBANK" as const,
      source,
      operationDate: new Date(transaction.operationDate),
      bookingDate: transaction.bookingDate ? new Date(transaction.bookingDate) : null,
      amount: transaction.amount,
      currency: transaction.currency,
      direction: transaction.direction,
      description: transaction.description,
      merchant: transaction.merchant,
      category: transaction.category,
      categorySource: categorySourceOrDefault(transaction.categorySource),
      accountLabel: transaction.accountLabel ?? null,
      balanceAfter: transaction.balanceAfter ?? null
    }));
}

function transactionIdentity(transaction: {
  operationDate: Date;
  bookingDate: Date | null;
  amount: number | Prisma.Decimal;
  direction: string;
  description: string;
  merchant: string | null;
  accountLabel?: string | null;
  balanceAfter?: number | Prisma.Decimal | null;
}) {
  return JSON.stringify([
    transaction.operationDate.toISOString(),
    transaction.bookingDate?.toISOString() ?? null,
    Number(transaction.amount).toFixed(2),
    transaction.direction,
    transaction.description,
    transaction.merchant,
    transaction.accountLabel ?? null,
    transaction.balanceAfter == null ? null : Number(transaction.balanceAfter).toFixed(2)
  ]);
}

async function materializeAcceptedTransactions(
  tx: Prisma.TransactionClient,
  batch: ImportBatch,
  parsed: StoredParsedTransaction[]
) {
  const isStatement = batch.provider === "MBANK_STATEMENT";

  if (isStatement && (!batch.periodStart || !batch.periodEnd)) {
    throw new Error("Statement import batch is missing its period range.");
  }

  let rows = transactionRows(batch, parsed);
  let supersededCount = 0;

  if (isStatement && rows.length > 0 && batch.periodStart && batch.periodEnd) {
    const periodWhere = {
      bookingDate: { gte: batch.periodStart, lte: batch.periodEnd },
      NOT: { importBatchId: batch.id }
    };
    const superseded = await tx.bankTransaction.findMany({ where: periodWhere, select: { importBatchId: true } });
    supersededCount = superseded.length;

    await tx.bankTransaction.deleteMany({ where: periodWhere });

    const affectedBatchIds = [...new Set(superseded.map((row) => row.importBatchId))];
    for (const affectedId of affectedBatchIds) {
      const remaining = await tx.bankTransaction.count({ where: { importBatchId: affectedId } });
      await tx.importBatch.update({ where: { id: affectedId }, data: { transactionCount: remaining } });
    }
  }

  if (!isStatement && rows.length > 0) {
    const statementPeriods = await tx.importBatch.findMany({
      where: { provider: "MBANK_STATEMENT", status: "IMPORTED", periodStart: { not: null }, periodEnd: { not: null } },
      select: { periodStart: true, periodEnd: true }
    });

    rows = rows.filter((row) => {
      const bookedAt = row.bookingDate ?? row.operationDate;
      return !statementPeriods.some((period) => period.periodStart! <= bookedAt && bookedAt <= period.periodEnd!);
    });
  }

  const existingRows = await tx.bankTransaction.findMany({ where: { importBatchId: batch.id } });
  const availableByIdentity = new Map<string, number>();
  for (const existing of existingRows) {
    const identity = transactionIdentity(existing);
    availableByIdentity.set(identity, (availableByIdentity.get(identity) ?? 0) + 1);
  }

  const missingRows = rows.filter((row) => {
    const identity = transactionIdentity(row);
    const available = availableByIdentity.get(identity) ?? 0;
    if (available === 0) {
      return true;
    }

    availableByIdentity.set(identity, available - 1);
    return false;
  });

  if (missingRows.length > 0) {
    await tx.bankTransaction.createMany({ data: missingRows });
  }

  return { created: existingRows.length + missingRows.length, superseded: supersededCount };
}

export async function confirmImportBatch(db: PrismaClient, batchId: string) {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });

  if (!batch) {
    throw new Error("Import batch not found.");
  }

  if (batch.status === "IMPORTED") {
    return { status: "already_imported" as const, created: 0, batch };
  }

  if (batch.status !== "PENDING_REVIEW") {
    throw new Error(`Import batch cannot be confirmed from status ${batch.status}.`);
  }

  const parsed = storedTransactions(batch.parsedTransactions);

  if (parsed.length === 0) {
    throw new Error("Import batch has no parsed transactions to confirm.");
  }

  const pendingTransactions = parsed.filter((transaction) => transaction.reviewStatus === "PENDING");

  if (pendingTransactions.length > 0) {
    throw new Error(`Import batch still has ${pendingTransactions.length} transaction(s) to review.`);
  }

  const includedTransactions = parsed.filter((transaction) => transaction.reviewStatus === "ACCEPTED");

  if (includedTransactions.length === 0) {
    throw new Error("Import batch has no accepted transactions. Accept at least one transaction or reject the batch.");
  }

  const updated = await db.$transaction(async (tx) => {
    const materialized = await materializeAcceptedTransactions(tx, batch, parsed);

    const nextBatch = await tx.importBatch.update({
      where: { id: batch.id },
      data: { status: "IMPORTED", transactionCount: materialized.created }
    });

    return { batch: nextBatch, ...materialized };
  });

  return { status: "imported" as const, created: updated.created, superseded: updated.superseded, batch: updated.batch };
}

export async function rejectImportBatch(db: PrismaClient, batchId: string): Promise<ImportBatch> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });

  if (!batch) {
    throw new Error("Import batch not found.");
  }

  if (!["PENDING_REVIEW", "FAILED"].includes(batch.status)) {
    throw new Error(`Import batch cannot be rejected from status ${batch.status}.`);
  }

  return db.importBatch.update({
    where: { id: batch.id },
    data: { status: "SKIPPED" }
  });
}

export async function rejectAllPendingImportBatches(db: PrismaClient): Promise<{ rejected: number }> {
  const pending = await db.importBatch.findMany({ where: { status: "PENDING_REVIEW" } });

  for (const batch of pending) {
    await db.importBatch.update({
      where: { id: batch.id },
      data: { status: "SKIPPED" }
    });
  }

  return { rejected: pending.length };
}

export async function deleteImportBatch(db: PrismaClient, batchId: string): Promise<{ deleted: boolean }> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });

  if (!batch) {
    throw new Error("Import batch not found.");
  }

  if (!["FAILED", "SKIPPED"].includes(batch.status)) {
    throw new Error(`Import batch cannot be deleted from status ${batch.status}.`);
  }

  const linkedTransactions = await db.bankTransaction.count({ where: { importBatchId: batch.id } });
  if (linkedTransactions > 0) {
    throw new Error(`Import batch has ${linkedTransactions} linked transaction(s) and cannot be deleted.`);
  }

  await db.importBatch.delete({ where: { id: batch.id } });
  return { deleted: true };
}

export async function deleteAllResolvedImportBatches(db: PrismaClient): Promise<{ deleted: number }> {
  const resolved = await db.importBatch.findMany({ where: { status: { in: ["FAILED", "SKIPPED"] } } });
  let deleted = 0;

  for (const batch of resolved) {
    const linkedTransactions = await db.bankTransaction.count({ where: { importBatchId: batch.id } });
    if (linkedTransactions === 0) {
      await db.importBatch.delete({ where: { id: batch.id } });
      deleted += 1;
    }
  }

  return { deleted };
}
