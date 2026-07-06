import { Prisma, type BankTransaction, type ImportBatch, type PrismaClient } from "@prisma/client";
import { readGmailMessage, searchMbankMessages, type GmailMessageBody, type GmailMessageSummary } from "./gmail-mcp-adapter";
import { MbankParseError, parseMbankEmail, type ParsedMbankTransaction } from "./mbank-parser";
import { EXPENSE_CATEGORIES, isExpenseCategory } from "@/domain/portfolio/categories";
import { recordTraceWarning, traceStep } from "@/domain/tracing/local-tracing";

const RESOURCE_ID = "local-user";

type GmailAdapter = {
  searchMbankMessages: () => Promise<GmailMessageSummary[]>;
  readGmailMessage: (message: GmailMessageSummary) => Promise<GmailMessageBody>;
};

type GmailReadAdapter = Pick<GmailAdapter, "readGmailMessage">;

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

type StoredParsedTransaction = {
  operationDate: string;
  bookingDate?: string | null;
  amount: number;
  currency: string;
  direction: "INFLOW" | "OUTFLOW";
  description: string;
  merchant: string | null;
  category: string;
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
    accountLabel: transaction.accountLabel ?? null,
    balanceAfter: transaction.balanceAfter ?? null
  };
}

function storedTransactions(value: Prisma.JsonValue | null | undefined): StoredParsedTransaction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is StoredParsedTransaction => {
    const candidate = item as Partial<StoredParsedTransaction>;
    return (
      typeof candidate.operationDate === "string" &&
      typeof candidate.amount === "number" &&
      (candidate.direction === "INFLOW" || candidate.direction === "OUTFLOW") &&
      typeof candidate.description === "string" &&
      typeof candidate.category === "string"
    );
  });
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
  const existing = await db.importBatch.findFirst({
    where: {
      provider: "MBANK_EMAIL",
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
      provider: "MBANK_EMAIL",
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

export async function syncMbankGmail(
  db: PrismaClient,
  options: { adapter?: GmailAdapter; traceId?: string } = {}
): Promise<MbankImportSyncResult> {
  const adapter = options.adapter ?? { searchMbankMessages, readGmailMessage };
  const traceId = options.traceId ?? `gmail-sync-${Date.now()}`;

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
      message: "No new mBank Gmail messages found.",
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

  for (const message of messages) {
    try {
      const fullMessage = await traceStep(db, { traceId, resourceId: RESOURCE_ID, name: "gmail-sync.read", input: { id: message.id } }, () =>
        adapter.readGmailMessage(message)
      );
      const parsed = await traceStep(db, { traceId, resourceId: RESOURCE_ID, name: "mbank-parser", input: { id: message.id } }, () =>
        parseMbankEmail(fullMessage.bodyText)
      );
      const result = await traceStep(db, { traceId, resourceId: RESOURCE_ID, name: "import-preview", input: { id: message.id } }, () =>
        createPendingBatch(db, fullMessage, parsed)
      );

      if (result.created) {
        created += 1;
      } else {
        duplicates += 1;
      }
    } catch (error) {
      if (isNonTransactionMbankEmail(error)) {
        skipped += 1;
        await createSkippedBatch(db, message, error);
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
      await createFailedBatch(db, message, error);
      await recordTraceWarning(db, {
        traceId,
        resourceId: RESOURCE_ID,
        name: "gmail-sync.message-failed",
        input: { id: message.id },
        message: safeErrorMessage(error)
      });
    }
  }

  return {
    status: "completed",
    message: `Prepared ${created} import preview(s), skipped ${duplicates} duplicate(s), skipped ${skipped} non-transaction email(s), failed ${failed}.`,
    created,
    duplicates,
    failed,
    skipped
  };
}

export async function retryParseImportBatch(
  db: PrismaClient,
  batchId: string,
  options: { adapter?: GmailReadAdapter; traceId?: string } = {}
): Promise<MbankRetryParseResult> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });

  if (!batch) {
    throw new Error("Import batch not found.");
  }

  if (!["FAILED", "PENDING_REVIEW", "SKIPPED"].includes(batch.status)) {
    throw new Error(`Import batch cannot be retried from status ${batch.status}.`);
  }

  const adapter = options.adapter ?? { readGmailMessage };
  const traceId = options.traceId ?? `gmail-retry-${batch.id}-${Date.now()}`;
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
    const parsed = await traceStep(db, { traceId, resourceId: RESOURCE_ID, name: "gmail-retry.parser", input: { id: summary.id } }, () =>
      parseMbankEmail(fullMessage.bodyText)
    );
    const parsedTransactions = parsed.transactions.map(toStoredTransaction);
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

  const batch = await db.importBatch.findUnique({ where: { id: batchId } });

  if (!batch) {
    throw new Error("Import batch not found.");
  }

  if (batch.status !== "PENDING_REVIEW") {
    throw new Error(`Import batch category cannot be changed from status ${batch.status}.`);
  }

  const parsed = storedTransactions(batch.parsedTransactions);
  if (!parsed[transactionIndex]) {
    throw new Error("Import preview transaction not found.");
  }

  const parsedTransactions = parsed.map((transaction, index) =>
    index === transactionIndex ? { ...transaction, category: nextCategory } : transaction
  );

  return db.importBatch.update({
    where: { id: batch.id },
    data: { parsedTransactions: parsedTransactions as Prisma.InputJsonValue }
  });
}

export async function updateBankTransactionCategory(
  db: PrismaClient,
  transactionId: string,
  category: string
): Promise<BankTransaction> {
  const nextCategory = assertSupportedCategory(category);

  return db.bankTransaction.update({
    where: { id: transactionId },
    data: { category: nextCategory }
  });
}

export async function confirmImportBatch(db: PrismaClient, batchId: string) {
  const batch = await db.importBatch.findUnique({ where: { id: batchId }, include: { transactions: true } });

  if (!batch) {
    throw new Error("Import batch not found.");
  }

  if (batch.status === "IMPORTED") {
    return { status: "already_imported" as const, created: 0, batch };
  }

  if (batch.status !== "PENDING_REVIEW") {
    throw new Error(`Import batch cannot be confirmed from status ${batch.status}.`);
  }

  if (batch.transactions.length > 0) {
    await db.importBatch.update({ where: { id: batch.id }, data: { status: "IMPORTED" } });
    return { status: "already_imported" as const, created: 0, batch };
  }

  const parsed = storedTransactions(batch.parsedTransactions);

  if (parsed.length === 0) {
    throw new Error("Import batch has no parsed transactions to confirm.");
  }

  const updated = await db.$transaction(async (tx) => {
    await tx.bankTransaction.createMany({
      data: parsed.map((transaction) => ({
        importBatchId: batch.id,
        provider: "MBANK",
        source: "EMAIL",
        operationDate: new Date(transaction.operationDate),
        bookingDate: transaction.bookingDate ? new Date(transaction.bookingDate) : null,
        amount: transaction.amount,
        currency: transaction.currency,
        direction: transaction.direction,
        description: transaction.description,
        merchant: transaction.merchant,
        category: transaction.category,
        accountLabel: transaction.accountLabel ?? null,
        balanceAfter: transaction.balanceAfter ?? null
      }))
    });

    return tx.importBatch.update({
      where: { id: batch.id },
      data: { status: "IMPORTED", transactionCount: parsed.length }
    });
  });

  return { status: "imported" as const, created: parsed.length, batch: updated };
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
