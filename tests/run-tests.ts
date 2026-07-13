import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { buildLocalLlmReporterMessages, summarizeLocalReporterPayload } from "../src/domain/agents/local-llm-reporter";
import { analysePortfolio } from "../src/domain/agents/analyst";
import { analyseSpending } from "../src/domain/agents/spending-analyst";
import { critiqueReport } from "../src/domain/agents/report-critic";
import { reviewRisks } from "../src/domain/agents/risk-reviewer";
import { buildReportDraft } from "../src/domain/agents/reporter";
import {
  assertReadOnlyGmailTool,
  checkGmailMcpHealth,
  readGmailMessage,
  searchMbankMessages,
  validateGmailApiEndpoint,
  validateGmailMcpEndpoint,
  validateLocalGmailMcpEndpoint,
  validateOfficialGmailMcpEndpoint,
  type GmailMessageSummary
} from "../src/domain/imports/gmail-mcp-adapter";
import { confirmImportBatch, createImportDedupeKey, deleteAllResolvedImportBatches, deleteImportBatch, rejectAllPendingImportBatches, retryParseImportBatch, syncMbankGmail, updateBankTransactionCategory, updateImportPreviewTransactionCategory, updateImportPreviewTransactionInclusion } from "../src/domain/imports/mbank-import-pipeline";
import { categorizeMbankTransaction, parseMbankEmail } from "../src/domain/imports/mbank-parser";
import { parseMbankStatement, type StatementRow } from "../src/domain/imports/mbank-statement-parser";
import { categorizeTransactionsWithLlm, type LlmChatFn } from "../src/domain/imports/llm-categorizer";
import { calculateNextDailyRun } from "../src/domain/scheduler/daily-scheduler";
import { cleanupRetainedData } from "../src/domain/retention/cleanup";
import { buildWorkflowReportDraft } from "../src/domain/workflows/run-analysis";
import type { PortfolioContext } from "../src/domain/portfolio/types";
import { chatWithLocalLlm, validateLocalLlmEndpoint } from "../src/lib/llm/local-llm-client";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

const sampleContext: PortfolioContext = {
  asOf: new Date("2026-07-03T10:00:00.000Z"),
  baseCurrency: "PLN",
  totalValue: 100_000,
  positions: [
    {
      accountName: "Jan Kowalski private bank account",
      provider: "BANK",
      symbol: "CASH",
      name: "PLN cash",
      assetClass: "CASH",
      currency: "PLN",
      sector: null,
      quantity: 123.456,
      marketPrice: 789.01,
      marketValueBase: 20_000,
      weight: 20
    },
    {
      accountName: "XTB local account",
      provider: "XTB",
      symbol: "VWCE",
      name: "Vanguard FTSE All-World UCITS ETF",
      assetClass: "ETF_STOCK",
      currency: "USD",
      sector: "Global equities",
      quantity: 10,
      marketPrice: 8_000,
      marketValueBase: 80_000,
      weight: 80
    }
  ],
  transactions: [
    {
      id: "tx-1",
      operationDate: new Date("2026-07-02T00:00:00.000Z"),
      amount: 42.5,
      currency: "PLN",
      direction: "OUTFLOW",
      description: "BIEDRONKA zakupy spozywcze",
      merchant: "BIEDRONKA",
      category: "food",
      accountLabel: "eKonto"
    },
    {
      id: "tx-2",
      operationDate: new Date("2026-07-02T00:00:00.000Z"),
      amount: 5000,
      currency: "PLN",
      direction: "INFLOW",
      description: "Wynagrodzenie",
      merchant: "Employer",
      category: "income",
      accountLabel: "eKonto"
    }
  ],
  spendingSummary: {
    currentMonth: "2026-07",
    monthlyInflow: 5000,
    monthlyOutflow: 42.5,
    netCashflow: 4957.5,
    topCategories: [{ key: "food", label: "food", value: 42.5, percent: 100 }],
    recentTransactionCount: 2
  },
  imports: [
    {
      id: "batch-1",
      status: "IMPORTED",
      subject: "mBank operacje",
      operationDate: new Date("2026-07-02T00:00:00.000Z"),
      transactionCount: 2,
      errorMessage: null,
      createdAt: new Date("2026-07-02T08:00:00.000Z")
    }
  ],
  reports: [],
  memory: {
    observations: [],
    reflections: []
  },
  allocationByClass: [
    { key: "ETF_STOCK", label: "ETF_STOCK", value: 80_000, percent: 80 },
    { key: "CASH", label: "CASH", value: 20_000, percent: 20 }
  ],
  allocationByCurrency: [
    { key: "USD", label: "USD", value: 80_000, percent: 80 },
    { key: "PLN", label: "PLN", value: 20_000, percent: 20 }
  ],
  allocationByPosition: [
    { key: "VWCE", label: "VWCE - Vanguard FTSE All-World UCITS ETF", value: 80_000, percent: 80 },
    { key: "CASH", label: "CASH - PLN cash", value: 20_000, percent: 20 }
  ],
  missingData: ["Brak zewnętrznych snapshotów rynkowych."],
  dataSourcesUsed: ["test-fixture", "bank-transactions:mbank-email"],
  strategy: {
    resourceId: "local-user",
    profile: "balanced-growth",
    age: 32,
    lifeStage: "student",
    baseCurrency: "PLN",
    investmentHorizonYears: 15,
    riskTolerance: "medium",
    monthlyIncome: 5000,
    monthlyFixedCosts: 2500,
    monthlyInvestmentCapacity: 1000,
    goals: ["Kapitał długoterminowy"],
    constraints: ["Read-only app"],
    preferredReportLength: "short",
    preferredReportLanguage: "pl",
    targetAllocation: {
      CASH: 15,
      ETF_STOCK: 50,
      STOCK: 10,
      BOND: 10,
      CRYPTO: 10,
      COMMODITY: 5,
      OTHER: 0
    },
    maxSinglePositionPercent: 35,
    maxCryptoPercent: 20,
    minCashPercent: 8,
    privacyRules: {
      anonymizePersonalData: false,
      sendOnlyAggregatesToLlm: false
    }
  }
};

function mbankFixture() {
  return readFileSync(join(process.cwd(), "tests/fixtures/mbank-real-format-anon.txt"), "utf8");
}

function mbankStatementRowsFixture(): StatementRow[] {
  return JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/mbank-statement-rows-anon.json"), "utf8"));
}

// Offline categorizer for sync tests: mirrors the deterministic keyword seed so
// tests never depend on a running local LLM.
const deterministicCategorize = async (
  transactions: Array<{ description: string; merchant: string | null; direction: "INFLOW" | "OUTFLOW" }>
) => transactions.map((transaction) => categorizeMbankTransaction(`${transaction.merchant ?? ""} ${transaction.description}`, transaction.direction));

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bufferToBase64Url(value: Buffer) {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Could not allocate test server port.");
  }

  return address.port;
}

async function readRequestJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res: ServerResponse, value: unknown) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

type FakeImportBatch = {
  id: string;
  provider: "MBANK_EMAIL" | "MBANK_STATEMENT";
  source: "GMAIL_MCP";
  gmailMessageId: string;
  gmailThreadId: string | null;
  subject: string | null;
  sender: string | null;
  operationDate: Date | null;
  receivedAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  status: string;
  transactionCount: number;
  parsedTransactions: unknown;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeBankTransaction = {
  id: string;
  importBatchId: string;
  operationDate: Date;
  bookingDate: Date | null;
  amount: number;
  currency: string;
  direction: string;
  description: string;
  merchant: string | null;
  category: string;
  accountLabel: string | null;
  balanceAfter: number | null;
};

type FakeDateRange = { gte?: Date; lte?: Date };

type FakeBatchWhere = {
  id?: string;
  provider?: string;
  gmailMessageId?: string;
  operationDate?: Date | null;
  periodStart?: Date | null | { not: null };
  periodEnd?: Date | null | { not: null };
  status?: string | { in: string[] };
  NOT?: { id?: string };
};

type FakeTransactionWhere = {
  importBatchId?: string;
  bookingDate?: FakeDateRange;
  NOT?: { importBatchId?: string };
};

type FakeDb = {
  traceSpan: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown> & { id: string }>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  };
  importBatch: {
    create(args: { data: Partial<FakeImportBatch> }): Promise<FakeImportBatch>;
    findFirst(args: { where?: FakeBatchWhere; orderBy?: unknown }): Promise<FakeImportBatch | null>;
    findMany(args: { where?: FakeBatchWhere; select?: unknown }): Promise<FakeImportBatch[]>;
    findUnique(args: { where: { id: string }; include?: { transactions?: boolean } }): Promise<(FakeImportBatch & { transactions?: FakeBankTransaction[] }) | null>;
    update(args: { where: { id: string }; data: Partial<FakeImportBatch> }): Promise<FakeImportBatch>;
    delete(args: { where: { id: string } }): Promise<FakeImportBatch>;
  };
  bankTransaction: {
    createMany(args: { data: Array<Partial<FakeBankTransaction>> }): Promise<{ count: number }>;
    findMany(args: { where?: FakeTransactionWhere; select?: unknown }): Promise<FakeBankTransaction[]>;
    deleteMany(args: { where?: FakeTransactionWhere }): Promise<{ count: number }>;
    count(args: { where?: FakeTransactionWhere }): Promise<number>;
    update(args: { where: { id: string }; data: Partial<FakeBankTransaction> }): Promise<FakeBankTransaction>;
  };
  $transaction<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T>;
};

function sameDate(a: Date | null, b: Date | null | undefined) {
  if (b === undefined) {
    return true;
  }

  if (a === null || b === null) {
    return a === b;
  }

  return a.toISOString() === b.toISOString();
}

function createImportHarness() {
  const batches: FakeImportBatch[] = [];
  const transactions: FakeBankTransaction[] = [];
  const spans = new Map<string, Record<string, unknown>>();
  let batchSeq = 0;
  let transactionSeq = 0;
  let spanSeq = 0;

  function notNullMatches(value: Date | null, condition: Date | null | { not: null } | undefined) {
    if (condition === undefined) {
      return true;
    }

    if (condition !== null && typeof condition === "object" && "not" in condition) {
      return value !== null;
    }

    return sameDate(value, condition);
  }

  function matches(batch: FakeImportBatch, where: FakeBatchWhere | undefined) {
    if (!where) {
      return true;
    }

    return (
      (where.id === undefined || batch.id === where.id) &&
      (where.provider === undefined || batch.provider === where.provider) &&
      (where.gmailMessageId === undefined || batch.gmailMessageId === where.gmailMessageId) &&
      sameDate(batch.operationDate, where.operationDate) &&
      notNullMatches(batch.periodStart, where.periodStart) &&
      notNullMatches(batch.periodEnd, where.periodEnd) &&
      (where.status === undefined || (typeof where.status === "string" ? batch.status === where.status : where.status.in.includes(batch.status))) &&
      (where.NOT?.id === undefined || batch.id !== where.NOT.id)
    );
  }

  function transactionMatches(transaction: FakeBankTransaction, where: FakeTransactionWhere | undefined) {
    if (!where) {
      return true;
    }

    if (where.importBatchId !== undefined && transaction.importBatchId !== where.importBatchId) {
      return false;
    }

    if (where.NOT?.importBatchId !== undefined && transaction.importBatchId === where.NOT.importBatchId) {
      return false;
    }

    if (where.bookingDate) {
      const value = transaction.bookingDate;
      if (value === null) {
        return false;
      }
      if (where.bookingDate.gte && value.getTime() < where.bookingDate.gte.getTime()) {
        return false;
      }
      if (where.bookingDate.lte && value.getTime() > where.bookingDate.lte.getTime()) {
        return false;
      }
    }

    return true;
  }

  const db = {} as FakeDb;
  db.traceSpan = {
    async create({ data }) {
      const span = { id: `span-${++spanSeq}`, ...data };
      spans.set(span.id, span);
      return span;
    },
    async update({ where, data }) {
      const span = spans.get(where.id) ?? { id: where.id };
      const updated = { ...span, ...data };
      spans.set(where.id, updated);
      return updated;
    }
  };
  db.importBatch = {
    async create({ data }) {
      const now = new Date("2026-07-04T10:00:00.000Z");
      const batch: FakeImportBatch = {
        id: `batch-${++batchSeq}`,
        provider: data.provider ?? "MBANK_EMAIL",
        source: "GMAIL_MCP",
        gmailMessageId: String(data.gmailMessageId),
        gmailThreadId: data.gmailThreadId ?? null,
        subject: data.subject ?? null,
        sender: data.sender ?? null,
        operationDate: data.operationDate ?? null,
        receivedAt: data.receivedAt ?? null,
        periodStart: data.periodStart ?? null,
        periodEnd: data.periodEnd ?? null,
        status: data.status ?? "PENDING_REVIEW",
        transactionCount: data.transactionCount ?? 0,
        parsedTransactions: data.parsedTransactions ?? null,
        errorMessage: data.errorMessage ?? null,
        createdAt: now,
        updatedAt: now
      };
      batches.push(batch);
      return batch;
    },
    async findFirst({ where }) {
      return batches.find((batch) => matches(batch, where)) ?? null;
    },
    async findMany({ where }) {
      return batches.filter((batch) => matches(batch, where));
    },
    async findUnique({ where, include }) {
      const batch = batches.find((item) => item.id === where.id) ?? null;
      if (!batch) {
        return null;
      }

      return include?.transactions ? { ...batch, transactions: transactions.filter((transaction) => transaction.importBatchId === batch.id) } : batch;
    },
    async update({ where, data }) {
      const batch = batches.find((item) => item.id === where.id);
      if (!batch) {
        throw new Error(`Missing fake batch ${where.id}`);
      }

      Object.assign(batch, data, { updatedAt: new Date("2026-07-04T10:05:00.000Z") });
      return batch;
    },
    async delete({ where }) {
      const index = batches.findIndex((item) => item.id === where.id);
      if (index === -1) {
        throw new Error(`Missing fake batch ${where.id}`);
      }

      const [removed] = batches.splice(index, 1);
      return removed;
    }
  };
  db.bankTransaction = {
    async createMany({ data }) {
      for (const item of data) {
        transactions.push({
          id: `tx-${++transactionSeq}`,
          importBatchId: String(item.importBatchId),
          operationDate: item.operationDate instanceof Date ? item.operationDate : new Date(String(item.operationDate)),
          bookingDate: item.bookingDate instanceof Date ? item.bookingDate : null,
          amount: Number(item.amount),
          currency: String(item.currency ?? "PLN"),
          direction: String(item.direction),
          description: String(item.description),
          merchant: item.merchant == null ? null : String(item.merchant),
          category: String(item.category ?? "other"),
          accountLabel: item.accountLabel == null ? null : String(item.accountLabel),
          balanceAfter: item.balanceAfter == null ? null : Number(item.balanceAfter)
        });
      }

      return { count: data.length };
    },
    async findMany({ where }) {
      return transactions.filter((transaction) => transactionMatches(transaction, where));
    },
    async deleteMany({ where }) {
      const removed = transactions.filter((transaction) => transactionMatches(transaction, where));
      for (const transaction of removed) {
        transactions.splice(transactions.indexOf(transaction), 1);
      }
      return { count: removed.length };
    },
    async count({ where }) {
      return transactions.filter((transaction) => transactionMatches(transaction, where)).length;
    },
    async update({ where, data }) {
      const transaction = transactions.find((item) => item.id === where.id);
      if (!transaction) {
        throw new Error(`Missing fake transaction ${where.id}`);
      }

      Object.assign(transaction, data);
      return transaction;
    }
  };
  db.$transaction = async function transaction<T>(fn: (tx: PrismaClient) => Promise<T>) {
    return fn(db as unknown as PrismaClient);
  };

  return { db: db as unknown as PrismaClient, state: { batches, transactions, spans } };
}

function mcpMockServer(calls: string[]) {
  const fixture = mbankFixture();

  return createServer(async (req, res) => {
    try {
      const body = (await readRequestJson(req)) as { params?: { name?: unknown; arguments?: { messageId?: unknown } } };
      const name = typeof body.params?.name === "string" ? body.params.name : "";
      calls.push(name);

      if (name === "gmail.profile") {
        sendJson(res, { result: { email: "anon@example.local" } });
        return;
      }

      if (name === "gmail.search") {
        sendJson(res, {
          result: {
            messages: [
              { id: "msg-anon-1", threadId: "thread-anon", subject: "mBank - operacja", sender: "mBank", receivedAt: "2026-07-02T08:00:00.000Z" },
              { id: "msg-anon-2", threadId: "thread-anon", subject: "mBank - older", sender: "mBank", receivedAt: "2026-07-01T08:00:00.000Z" }
            ]
          }
        });
        return;
      }

      if (name === "gmail.read") {
        sendJson(res, {
          result: {
            id: body.params?.arguments?.messageId ?? "msg-anon-1",
            threadId: "thread-anon",
            subject: "mBank - operacja",
            sender: "mBank",
            bodyText: fixture
          }
        });
        return;
      }

      sendJson(res, { error: { message: `Unexpected tool ${name}` } });
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : "mock error" } }));
    }
  });
}

const tests: TestCase[] = [
  {
    name: "local LLM endpoint validation rejects external URLs",
    run() {
      const result = validateLocalLlmEndpoint("https://api.openai.com/v1/chat/completions");
      assert.equal(result.success, false);
    }
  },
  {
    name: "local LLM chat handles timeouts",
    async run() {
      const server = createServer(() => {
        // Leave the response open long enough for AbortController to cancel.
      });
      const port = await listen(server);

      try {
        const result = await chatWithLocalLlm([{ role: "user", content: "ping" }], {
          baseUrl: `http://127.0.0.1:${port}`,
          model: "gemma3:4b",
          timeoutMs: 20
        });

        assert.equal(result.success, false);
        if (!result.success) {
          assert.equal(result.error.code, "timeout");
        }
      } finally {
        server.close();
      }
    }
  },
  {
    name: "workflow falls back to deterministic reporter when local LLM fails",
    async run() {
      const portfolio = analysePortfolio(sampleContext);
      const spending = analyseSpending(sampleContext);
      const riskFlags = [...spending.riskFlags, ...reviewRisks(sampleContext)];
      const result = await buildWorkflowReportDraft({
        context: sampleContext,
        analystResult: {
          summary: `${spending.summary} ${portfolio.summary}`,
          opportunities: [...spending.opportunities, ...portfolio.opportunities],
          recommendations: [...spending.recommendations, ...portfolio.recommendations],
          rebalancingPlan: portfolio.rebalancingPlan,
          unknowns: [...sampleContext.missingData, ...spending.unknowns, ...portfolio.unknowns]
        },
        riskFlags,
        llmReporterEnabled: true,
        llmModel: "gemma3:4b",
        localReporter: async () => ({
          success: false,
          error: "network_error: Ollama is unavailable."
        })
      });

      assert.equal(result.reporterSource, "deterministic");
      assert.equal(result.reporterModel, "gemma3:4b");
      assert.equal(result.contextLimits.recentTransactions.omitted, 0);
      assert.match(result.warning ?? "", /Ollama is unavailable/);
      assert.match(result.reportDraft.markdown, /Spending/);
    }
  },
  {
    name: "workflow records local-gemma reporter success when local reporter succeeds",
    async run() {
      const portfolio = analysePortfolio(sampleContext);
      const spending = analyseSpending(sampleContext);
      const riskFlags = [...spending.riskFlags, ...reviewRisks(sampleContext)];
      const result = await buildWorkflowReportDraft({
        context: sampleContext,
        analystResult: {
          summary: `${spending.summary} ${portfolio.summary}`,
          opportunities: [...spending.opportunities, ...portfolio.opportunities],
          recommendations: [...spending.recommendations, ...portfolio.recommendations],
          rebalancingPlan: portfolio.rebalancingPlan,
          unknowns: [...sampleContext.missingData, ...spending.unknowns, ...portfolio.unknowns]
        },
        riskFlags,
        llmReporterEnabled: true,
        llmModel: "gemma3:4b",
        localReporter: async () => ({
          success: true,
          model: "gemma3:4b",
          report: {
            title: "Portfolio Copilot local Gemma report - test",
            summary: "Local Gemma summary",
            allocation: {
              byClass: sampleContext.allocationByClass,
              byCurrency: sampleContext.allocationByCurrency,
              byPosition: sampleContext.allocationByPosition
            },
            riskFlags,
            opportunities: [],
            recommendations: [],
            rebalancingPlan: [],
            unknowns: sampleContext.missingData,
            sources: sampleContext.dataSourcesUsed,
            markdown: "# Report\n\nRead-only constraint: test report only."
          }
        })
      });

      assert.equal(result.reporterSource, "local-gemma");
      assert.equal(result.reporterModel, "gemma3:4b");
      assert.equal(result.warning, null);
      assert.match(result.reportDraft.markdown, /Read-only constraint:/);
      assert.deepEqual(result.reportDraft.sources, sampleContext.dataSourcesUsed);
    }
  },
  {
    name: "local LLM reporter payload includes caps, local profile and summarized transactions",
    run() {
      const transactions = Array.from({ length: 45 }, (_, index) => ({
        ...sampleContext.transactions[0],
        id: `tx-many-${index}`,
        description: `BIEDRONKA anon transaction ${index} with a deliberately long description that should be clipped before it reaches the reporter payload`
      }));
      const context: PortfolioContext = { ...sampleContext, transactions };
      const portfolio = analysePortfolio(context);
      const spending = analyseSpending(context);
      const riskFlags = [...spending.riskFlags, ...reviewRisks(context)];
      const content = buildLocalLlmReporterMessages(
        context,
        {
          summary: `${spending.summary} ${portfolio.summary}`,
          opportunities: [...spending.opportunities, ...portfolio.opportunities],
          recommendations: [...spending.recommendations, ...portfolio.recommendations],
          rebalancingPlan: portfolio.rebalancingPlan,
          unknowns: [...context.missingData, ...spending.unknowns, ...portfolio.unknowns]
        },
        riskFlags
      )
        .map((message) => message.content)
        .join("\n");

      assert.equal(summarizeLocalReporterPayload(context).recentTransactions.omitted, 33);
      assert.match(content, /profile=student; risk=medium; horizonYears=15/);
      assert.match(content, /outflowCategories=food:/);
      assert.match(content, /bank-transactions:mbank-email/);
      assert.match(content, /transactions 12\/45 omitted 33/);
      assert.doesNotMatch(content, /BIEDRONKA/);
      assert.doesNotMatch(content, /Jan Kowalski/);
    }
  },
  {
    name: "mBank parser normalizes anonymized real-like key-value fixture",
    run() {
      const parsed = parseMbankEmail(mbankFixture());
      const transaction = parsed.transactions[0];

      assert.equal(parsed.operationDate.toISOString().slice(0, 10), "2026-07-02");
      assert.equal(parsed.transactions.length, 1);
      assert.equal(transaction?.direction, "OUTFLOW");
      assert.equal(transaction?.amount, 42.5);
      assert.equal(transaction?.currency, "PLN");
      assert.equal(transaction?.merchant, "BIEDRONKA ANON STORE 0000");
      assert.equal(transaction?.category, "food");
      assert.equal(transaction?.accountLabel, "eKonto 12 **** **** **** **** 3456");
      assert.equal(transaction?.balanceAfter, 1234.56);
    }
  },

  {
    name: "mBank parser normalizes notification HTML operation line",
    run() {
      const parsed = parseMbankEmail(`mBank S.A.
Bankowosc Detaliczna
Regulamin obowiazuje od 2024-01-01
JAN KOWALSKI
JAN.KOWALSKI@example.com

2026-07-02 - Powiadomienie e-mail
Operacje
Czas operacji
(GG:MM)
Opis operacji
06:13	mBank: Przelew wych. z rach. 78823023 na rach. 3014...032401 kwota 300,00 PLN dla ANNA KOWALSKA; ZWROT ZA ZAKUPY; Dost. 1479,06 PLN
Numer referencyjny maila: X.
`);

      assert.equal(parsed.operationDate.toISOString().slice(0, 10), "2026-07-02");
      assert.equal(parsed.transactions.length, 1);
      assert.equal(parsed.transactions[0]?.amount, 300);
      assert.equal(parsed.transactions[0]?.currency, "PLN");
      assert.equal(parsed.transactions[0]?.direction, "OUTFLOW");
      assert.equal(parsed.transactions[0]?.balanceAfter, 1479.06);
      assert.match(parsed.transactions[0]?.description ?? "", /ZWROT ZA ZAKUPY/);
      assert.equal(parsed.transactions[0]?.category, "people_transfers");
    }
  },
  {
    name: "mBank parser handles HTML body artifacts for the observed shape",
    run() {
      const parsed = parseMbankEmail(`<html><body><p>Data operacji: 02.07.2026</p><p>Rodzaj operacji: Płatność kartą</p><p>Kwota operacji: -42,50&nbsp;PLN</p><p>Odbiorca: BIEDRONKA ANON</p><p>Opis operacji: Płatność kartą</p></body></html>`);

      assert.equal(parsed.transactions.length, 1);
      assert.equal(parsed.transactions[0]?.direction, "OUTFLOW");
      assert.equal(parsed.transactions[0]?.amount, 42.5);
    }
  },
  {
    name: "mBank parser normalizes synthetic table fixture",
    run() {
      const parsed = parseMbankEmail(`Data operacji: 2026-07-02
2026-07-02 | -42,50 PLN | BIEDRONKA | Zakupy spożywcze | Saldo: 1234,56 PLN
2026-07-02 | +5 000,00 PLN | Wynagrodzenie | Przelew przychodzący`);

      assert.equal(parsed.operationDate.toISOString().slice(0, 10), "2026-07-02");
      assert.equal(parsed.transactions.length, 2);
      assert.equal(parsed.transactions[0]?.direction, "OUTFLOW");
      assert.equal(parsed.transactions[0]?.category, "food");
      assert.equal(parsed.transactions[1]?.direction, "INFLOW");
      assert.equal(parsed.transactions[1]?.category, "income");
    }
  },
  {
    name: "category rules keep stable taxonomy and fallback",
    run() {
      assert.equal(categorizeMbankTransaction("Spotify Premium", "OUTFLOW"), "subscriptions");
      assert.equal(categorizeMbankTransaction("mBank: Przelew wych. z rach. 123 na rach. 456 kwota 300,00 PLN dla ANNA KOWALSKA; ZWROT ZA ZAKUPY", "OUTFLOW"), "people_transfers");
      assert.equal(categorizeMbankTransaction("Nieznany kontrahent", "OUTFLOW"), "other");
      assert.equal(categorizeMbankTransaction("Wynagrodzenie", "INFLOW"), "income");
    }
  },
  {
    name: "Gmail adapter validates local MCP official MCP and Gmail API endpoints",
    run() {
      assert.equal(validateLocalGmailMcpEndpoint("https://gmail.googleapis.com/mcp").success, false);
      assert.equal(validateLocalGmailMcpEndpoint("http://127.0.0.1:3005/mcp").success, true);
      assert.equal(validateOfficialGmailMcpEndpoint("https://gmailmcp.googleapis.com/mcp/v1").success, true);
      assert.equal(validateOfficialGmailMcpEndpoint("https://gmail.googleapis.com/mcp").success, false);
      assert.equal(validateGmailApiEndpoint("https://gmail.googleapis.com/gmail/v1").success, true);
      assert.equal(validateGmailApiEndpoint("http://gmail.googleapis.com/gmail/v1").success, false);
      assert.equal(validateGmailMcpEndpoint("https://gmailmcp.googleapis.com/mcp/v1", "google-official").success, true);
      assert.equal(validateGmailMcpEndpoint("https://gmail.googleapis.com/gmail/v1", "gmail-api").success, true);
      assert.doesNotThrow(() => assertReadOnlyGmailTool("gmail.search"));
      assert.doesNotThrow(() => assertReadOnlyGmailTool("search_threads"));
      assert.doesNotThrow(() => assertReadOnlyGmailTool("get_thread"));
      assert.doesNotThrow(() => assertReadOnlyGmailTool("list_labels"));
      assert.doesNotThrow(() => assertReadOnlyGmailTool("users.messages.list"));
      assert.doesNotThrow(() => assertReadOnlyGmailTool("users.messages.get"));
      assert.throws(() => assertReadOnlyGmailTool("gmail.archive"), /read-only allowlist/);
      assert.throws(() => assertReadOnlyGmailTool("create_draft"), /read-only allowlist/);
      assert.throws(() => assertReadOnlyGmailTool("label_thread"), /read-only allowlist/);
    }
  },
  {
    name: "local Gmail MCP mock contract uses profile search read only and caps to one message",
    async run() {
      const calls: string[] = [];
      const server = mcpMockServer(calls);
      const port = await listen(server);
      const baseUrl = `http://127.0.0.1:${port}/mcp`;
      const config = { enabled: true, provider: "local" as const, baseUrl, query: "rfc822msgid:anon", dailyLookbackDays: 1, maxMessages: 1, timeoutMs: 500 };

      try {
        const health = await checkGmailMcpHealth(config);
        const messages = await searchMbankMessages(config);
        const message = await readGmailMessage(messages[0] as GmailMessageSummary, config);

        assert.equal(health.available, true);
        assert.equal(messages.length, 1);
        assert.equal(message.id, "msg-anon-1");
        assert.match(message.bodyText, /Kwota operacji/);
        assert.deepEqual(calls, ["gmail.profile", "gmail.search", "gmail.read"]);
        assert.equal(calls.some((tool) => /archive|trash|send|draft|modify|label_message|label_thread|create_label/i.test(tool)), false);
      } finally {
        server.close();
      }
    }
  },

  {
    name: "Gmail API contract uses profile list and message get read only",
    async run() {
      const originalFetch = globalThis.fetch;
      const calls: string[] = [];
      const fixture = mbankFixture();

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof URL ? input.href : String(input));
        const headers = new Headers(init?.headers);
        assert.equal(init?.method, "GET");
        assert.equal(headers.get("authorization"), "Bearer access-api");
        calls.push(url.pathname);

        if (url.pathname === "/gmail/v1/users/me/profile") {
          return new Response(JSON.stringify({ emailAddress: "user@example.com", messagesTotal: 2 }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }

        if (url.pathname === "/gmail/v1/users/me/messages") {
          assert.equal(url.searchParams.get("maxResults"), "1");
          assert.equal(url.searchParams.get("q"), "rfc822msgid:anon");
          return new Response(JSON.stringify({
            messages: [
              { id: "msg-api-1", threadId: "thread-api-1" },
              { id: "msg-api-2", threadId: "thread-api-2" }
            ],
            resultSizeEstimate: 2
          }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }

        if (url.pathname === "/gmail/v1/users/me/messages/msg-api-1") {
          assert.equal(url.searchParams.get("format"), "full");
          return new Response(JSON.stringify({
            id: "msg-api-1",
            threadId: "thread-api-1",
            snippet: "mBank operation",
            internalDate: String(Date.parse("2026-07-02T08:00:00.000Z")),
            payload: {
              mimeType: "multipart/alternative",
              headers: [
                { name: "Subject", value: "mBank - operacja" },
                { name: "From", value: "mBank <no-reply@example.com>" },
                { name: "Date", value: "Thu, 02 Jul 2026 08:00:00 +0000" }
              ],
              parts: [
                {
                  mimeType: "text/plain",
                  body: { data: toBase64Url(fixture) }
                }
              ]
            }
          }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ error: { message: "Unexpected Gmail API path " + url.pathname } }), {
          status: 404,
          headers: { "content-type": "application/json" }
        });
      }) as typeof fetch;

      const config = {
        enabled: true,
        provider: "gmail-api" as const,
        baseUrl: "https://gmail.googleapis.com/gmail/v1",
        query: "rfc822msgid:anon",
        dailyLookbackDays: 1,
        maxMessages: 1,
        timeoutMs: 500,
        accessToken: "access-api"
      };

      try {
        const health = await checkGmailMcpHealth(config);
        const messages = await searchMbankMessages(config);
        const message = await readGmailMessage(messages[0] as GmailMessageSummary, config);

        assert.equal(health.available, true);
        assert.equal(messages.length, 1);
        assert.equal(messages[0]?.id, "msg-api-1");
        assert.equal(messages[0]?.threadId, "thread-api-1");
        assert.equal(message.subject, "mBank - operacja");
        assert.equal(message.sender, "mBank <no-reply@example.com>");
        assert.equal(message.receivedAt?.toISOString(), "2026-07-02T08:00:00.000Z");
        assert.match(message.bodyText, /Kwota operacji/);
        assert.deepEqual(calls, ["/gmail/v1/users/me/profile", "/gmail/v1/users/me/messages", "/gmail/v1/users/me/messages/msg-api-1"]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  },
  {
    name: "Gmail API contract reads mBank HTML attachment for notification imports",
    async run() {
      const originalFetch = globalThis.fetch;
      const calls: string[] = [];
      const htmlAttachment = `<html><head><meta charset="windows-1250"></head><body><p>2026-07-02 - Powiadomienie e-mail</p><p>Operacje</p><p>Czas operacji</p><p>Opis operacji</p><p>06:13 mBank: Przelew wych. z rach. 78823023 na rach. 3014...032401 kwota 300,00 PLN dla MONIKA MAŁGORZATA KO; ZWROT ZA ZAKUPY; Dost. 1479,06 PLN</p></body></html>`;
      const htmlAttachmentBytes = Buffer.from(htmlAttachment, "latin1");

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof URL ? input.href : String(input));
        const headers = new Headers(init?.headers);
        assert.equal(init?.method, "GET");
        assert.equal(headers.get("authorization"), "Bearer access-api");
        calls.push(url.pathname);

        if (url.pathname === "/gmail/v1/users/me/messages/msg-api-html") {
          return new Response(JSON.stringify({
            id: "msg-api-html",
            threadId: "thread-api-html",
            snippet: "mBank notification",
            payload: {
              mimeType: "multipart/mixed",
              headers: [
                { name: "Subject", value: "mBank - powiadomienie e-mail" },
                { name: "From", value: "mBank <no-reply@example.com>" },
                { name: "Date", value: "Thu, 02 Jul 2026 08:00:00 +0000" }
              ],
              parts: [
                { mimeType: "text/plain", body: { data: toBase64Url("Ogólna treść bez danych operacji") } },
                { filename: "Powiadomienie e-mail z 2026-07-02.htm", mimeType: "text/html", body: { attachmentId: "att-html-1", size: htmlAttachment.length } }
              ]
            }
          }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }

        if (url.pathname === "/gmail/v1/users/me/messages/msg-api-html/attachments/att-html-1") {
          return new Response(JSON.stringify({ data: bufferToBase64Url(htmlAttachmentBytes), size: htmlAttachmentBytes.length }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ error: { message: "Unexpected Gmail API path " + url.pathname } }), {
          status: 404,
          headers: { "content-type": "application/json" }
        });
      }) as typeof fetch;

      const summary: GmailMessageSummary = { id: "msg-api-html", threadId: "thread-api-html", subject: null, sender: null, receivedAt: null, snippet: null };
      const config = {
        enabled: true,
        provider: "gmail-api" as const,
        baseUrl: "https://gmail.googleapis.com/gmail/v1",
        query: "rfc822msgid:html",
        dailyLookbackDays: 1,
        maxMessages: 1,
        timeoutMs: 500,
        accessToken: "access-api"
      };

      try {
        const message = await readGmailMessage(summary, config);
        const parsed = parseMbankEmail(message.bodyText);

        assert.equal(parsed.transactions.length, 1);
        assert.equal(parsed.transactions[0]?.amount, 300);
        assert.equal(parsed.transactions[0]?.direction, "OUTFLOW");
        assert.equal(parsed.transactions[0]?.category, "people_transfers");
        assert.match(message.bodyText, /Powiadomienie e-mail/);
        assert.doesNotMatch(message.bodyText, /�/);
        assert.deepEqual(calls, ["/gmail/v1/users/me/messages/msg-api-html", "/gmail/v1/users/me/messages/msg-api-html/attachments/att-html-1"]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  },
  {
    name: "official Gmail MCP contract uses OAuth list_labels search_threads and get_thread",
    async run() {
      const originalFetch = globalThis.fetch;
      const calls: string[] = [];
      let tokenCalls = 0;
      const fixture = mbankFixture();

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof URL ? input.href : String(input);

        if (url === "https://oauth2.googleapis.com/token") {
          tokenCalls += 1;
          return new Response(JSON.stringify({ access_token: "access-official", expires_in: 3600 }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }

        assert.equal(url, "https://gmailmcp.googleapis.com/mcp/v1");
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("authorization"), "Bearer access-official");
        const body = JSON.parse(String(init?.body ?? "{}")) as { params?: { name?: string; arguments?: Record<string, unknown> } };
        const name = body.params?.name ?? "";
        calls.push(name);

        if (name === "list_labels") {
          return new Response(JSON.stringify({ result: { labels: [{ id: "INBOX", name: "INBOX" }] } }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }

        if (name === "search_threads") {
          assert.equal(body.params?.arguments?.pageSize, 1);
          if (body.params?.arguments?.query !== undefined) {
            assert.equal(body.params?.arguments?.query, "rfc822msgid:anon");
          }
          return new Response(`data: ${JSON.stringify({
            result: {
              threads: [
                { id: "thread-official-1", subject: "mBank - operacja", sender: "mBank", date: "2026-07-02T08:00:00.000Z" },
                { id: "thread-official-2", subject: "mBank - older", sender: "mBank", date: "2026-07-01T08:00:00.000Z" }
              ]
            }
          })}\n\n`, {
            status: 200,
            headers: { "content-type": "text/event-stream" }
          });
        }

        if (name === "get_thread") {
          assert.equal(body.params?.arguments?.threadId, "thread-official-1");
          assert.equal(body.params?.arguments?.messageFormat, "FULL_CONTENT");
          return new Response(JSON.stringify({
            result: {
              content: [{ type: "text", text: "structured thread omitted" }],
              structuredContent: {
                id: "thread-official-1",
                messages: [
                  { id: "msg-official-1", threadId: "thread-official-1", subject: "mBank - operacja", from: "mBank", plaintextBody: fixture }
                ]
              }
            }
          }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ error: { message: "Unexpected official tool " + name } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }) as typeof fetch;

      const config = {
        enabled: true,
        provider: "google-official" as const,
        baseUrl: "https://gmailmcp.googleapis.com/mcp/v1",
        query: "rfc822msgid:anon",
        dailyLookbackDays: 1,
        maxMessages: 1,
        timeoutMs: 500,
        accessToken: "",
        refreshToken: "refresh-token",
        oauthClientId: "client-id",
        oauthClientSecret: "client-secret",
        oauthTokenUrl: "https://oauth2.googleapis.com/token",
        healthTool: "list_labels",
        searchTool: "search_threads",
        readTool: "get_thread"
      };

      try {
        const health = await checkGmailMcpHealth(config);
        const messages = await searchMbankMessages(config);
        const message = await readGmailMessage(messages[0] as GmailMessageSummary, config);

        assert.equal(health.available, true);
        assert.equal(messages.length, 1);
        assert.equal(messages[0]?.id, "thread-official-1");
        assert.equal(messages[0]?.threadId, "thread-official-1");
        assert.equal(message.threadId, "thread-official-1");
        assert.match(message.bodyText, /Kwota operacji/);
        assert.deepEqual(calls, ["list_labels", "search_threads", "get_thread"]);
        assert.equal(tokenCalls, 1);
        assert.equal(calls.some((tool) => /archive|trash|send|draft|modify|label_message|label_thread|create_label/i.test(tool)), false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  },
  {
    name: "mBank import pipeline supports sync preview confirm idempotency and dedupe",
    async run() {
      const { db, state } = createImportHarness();
      const summary: GmailMessageSummary = {
        id: "msg-realish-1",
        threadId: "thread-1",
        subject: "mBank - operacja",
        sender: "mBank",
        receivedAt: new Date("2026-07-02T08:00:00.000Z"),
        snippet: "mBank"
      };
      const adapter = {
        searchMbankMessages: async () => [summary],
        readGmailMessage: async () => ({ ...summary, bodyText: mbankFixture() })
      };

      const firstSync = await syncMbankGmail(db, { adapter, traceId: "test-sync", categorize: deterministicCategorize });
      assert.equal(firstSync.created, 1);
      assert.equal(state.batches.length, 1);
      assert.equal(state.batches[0]?.status, "PENDING_REVIEW");

      const updatedPreview = await updateImportPreviewTransactionCategory(db, String(state.batches[0]?.id), 0, "people_transfers");
      const updatedPreviewTransactions = updatedPreview.parsedTransactions as Array<{ category: string; included?: boolean }>;
      assert.equal(updatedPreviewTransactions[0]?.category, "people_transfers");

      const acceptedPreview = updatedPreviewTransactions[0]!;
      await db.importBatch.update({
        where: { id: String(state.batches[0]?.id) },
        data: {
          transactionCount: 2,
          parsedTransactions: [acceptedPreview, { ...acceptedPreview, description: "Rejected preview transaction" }]
        }
      });

      const rejectedPreview = await updateImportPreviewTransactionInclusion(db, String(state.batches[0]?.id), 1, false);
      assert.equal((rejectedPreview.parsedTransactions as Array<{ included?: boolean }>)[1]?.included, false);
      const acceptedAgain = await updateImportPreviewTransactionInclusion(db, String(state.batches[0]?.id), 1, true);
      assert.equal((acceptedAgain.parsedTransactions as Array<{ included?: boolean }>)[1]?.included, true);
      await updateImportPreviewTransactionInclusion(db, String(state.batches[0]?.id), 1, false);

      const confirmed = await confirmImportBatch(db, String(state.batches[0]?.id));
      assert.equal(confirmed.created, 1);
      assert.equal(state.transactions.length, 1);
      assert.equal(state.transactions[0]?.category, "people_transfers");
      assert.equal(state.batches[0]?.status, "IMPORTED");

      const updatedTransaction = await updateBankTransactionCategory(db, String(state.transactions[0]?.id), "shopping");
      assert.equal(updatedTransaction.category, "shopping");
      assert.equal(state.transactions[0]?.category, "shopping");

      const confirmedAgain = await confirmImportBatch(db, String(state.batches[0]?.id));
      assert.equal(confirmedAgain.created, 0);
      assert.equal(state.transactions.length, 1);

      const secondSync = await syncMbankGmail(db, { adapter, traceId: "test-sync-2", categorize: deterministicCategorize });
      assert.equal(secondSync.duplicates, 1);
      assert.equal(state.batches.length, 1);
    }
  },
  {
    name: "rejectAllPendingImportBatches rejects only pending-review batches",
    async run() {
      const { db, state } = createImportHarness();

      await db.importBatch.create({ data: { gmailMessageId: "msg-a", status: "PENDING_REVIEW" } });
      await db.importBatch.create({ data: { gmailMessageId: "msg-b", status: "PENDING_REVIEW" } });
      await db.importBatch.create({ data: { gmailMessageId: "msg-c", status: "IMPORTED" } });

      const { rejected } = await rejectAllPendingImportBatches(db);
      assert.equal(rejected, 2);
      assert.equal(state.batches.filter((batch) => batch.status === "SKIPPED").length, 2);
      assert.equal(state.batches.find((batch) => batch.gmailMessageId === "msg-c")?.status, "IMPORTED");

      const secondRun = await rejectAllPendingImportBatches(db);
      assert.equal(secondRun.rejected, 0);
    }
  },
  {
    name: "deleteImportBatch removes resolved batches with no linked transactions but refuses the rest",
    async run() {
      const { db, state } = createImportHarness();

      const skipped = await db.importBatch.create({ data: { gmailMessageId: "msg-skip", status: "SKIPPED" } });
      const failed = await db.importBatch.create({ data: { gmailMessageId: "msg-fail", status: "FAILED" } });
      const pending = await db.importBatch.create({ data: { gmailMessageId: "msg-pending", status: "PENDING_REVIEW" } });

      await assert.rejects(() => deleteImportBatch(db, pending.id), /cannot be deleted from status PENDING_REVIEW/);

      await db.bankTransaction.createMany({
        data: [{ importBatchId: failed.id, operationDate: new Date("2026-07-01T00:00:00.000Z"), amount: 10, direction: "OUTFLOW", description: "linked", category: "other" }]
      });
      await assert.rejects(() => deleteImportBatch(db, failed.id), /linked transaction/);

      const deleted = await deleteImportBatch(db, skipped.id);
      assert.equal(deleted.deleted, true);
      assert.equal(state.batches.length, 2);
      assert.equal(state.batches.some((batch) => batch.id === skipped.id), false);
    }
  },
  {
    name: "deleteAllResolvedImportBatches bulk-deletes failed/skipped batches without linked transactions",
    async run() {
      const { db, state } = createImportHarness();

      await db.importBatch.create({ data: { gmailMessageId: "msg-a", status: "SKIPPED" } });
      const blocked = await db.importBatch.create({ data: { gmailMessageId: "msg-b", status: "FAILED" } });
      await db.importBatch.create({ data: { gmailMessageId: "msg-c", status: "IMPORTED" } });
      await db.importBatch.create({ data: { gmailMessageId: "msg-d", status: "PENDING_REVIEW" } });

      await db.bankTransaction.createMany({
        data: [{ importBatchId: blocked.id, operationDate: new Date("2026-07-01T00:00:00.000Z"), amount: 5, direction: "OUTFLOW", description: "linked", category: "other" }]
      });

      const { deleted } = await deleteAllResolvedImportBatches(db);
      assert.equal(deleted, 1);
      assert.equal(state.batches.length, 3);
      assert.equal(state.batches.some((batch) => batch.gmailMessageId === "msg-a"), false);
      assert.equal(state.batches.find((batch) => batch.id === blocked.id)?.status, "FAILED");
    }
  },
  {
    name: "mBank statement parser extracts card purchases and validates against the summary totals",
    async run() {
      const parsed = parseMbankStatement(mbankStatementRowsFixture());

      assert.equal(parsed.periodStart.toISOString().slice(0, 10), "2026-06-01");
      assert.equal(parsed.periodEnd.toISOString().slice(0, 10), "2026-06-30");
      assert.equal(parsed.openingBalance, 100);
      assert.equal(parsed.closingBalance, 320);
      assert.equal(parsed.transactions.length, 4);

      // The card purchase only exists in the statement PDF, never in daily emails.
      const card = parsed.transactions.find((transaction) => transaction.merchant?.startsWith("ZABKA"));
      assert.ok(card, "expected the card purchase to be parsed");
      assert.equal(card?.direction, "OUTFLOW");
      assert.equal(card?.amount, 20);
      assert.equal(card?.category, "food");
      // Card transaction date (DATA TRANSAKCJI) wins over the booking date for operationDate.
      assert.equal(card?.operationDate.toISOString().slice(0, 10), "2026-05-31");
      assert.equal(card?.bookingDate?.toISOString().slice(0, 10), "2026-06-01");

      const personTransfer = parsed.transactions.find((transaction) => transaction.merchant?.startsWith("JAN KOWALSKI"));
      assert.equal(personTransfer?.category, "people_transfers");
      assert.equal(personTransfer?.direction, "INFLOW");

      const salary = parsed.transactions.find((transaction) => transaction.merchant?.startsWith("TESTOWA"));
      assert.equal(salary?.category, "income");
      assert.equal(salary?.amount, 200);
    }
  },
  {
    name: "mBank statement parser rejects a tampered balance chain",
    async run() {
      const rows = mbankStatementRowsFixture();
      const brokenRow = rows.find((row) => row.balance === "80,00");
      assert.ok(brokenRow, "expected a row with balance 80,00 to tamper");
      brokenRow!.balance = "81,00";

      assert.throws(() => parseMbankStatement(rows), /balance chain mismatch/i);
    }
  },
  {
    name: "LLM categorizer applies valid model answers and keeps deterministic seed otherwise",
    async run() {
      const transactions = [
        { description: "ZAKUP PRZY UŻYCIU KARTY; SALON FRYZJERSKI ELEGANCJA", merchant: "SALON FRYZJERSKI ELEGANCJA", direction: "OUTFLOW" as const, amount: 80, category: "other" as const },
        { description: "ZAKUP PRZY UŻYCIU KARTY; ZABKA Z123 KRAKOW PL", merchant: "ZABKA Z123 KRAKOW PL", direction: "OUTFLOW" as const, amount: 12, category: "food" as const },
        { description: "BLIK ZAKUP E-COMMERCE; STEAM GAMES", merchant: "STEAM GAMES", direction: "OUTFLOW" as const, amount: 60, category: "shopping" as const }
      ];

      // The model recognises the hair salon (which no keyword covers) and returns
      // a Polish label for row 3; it omits row 2, which keeps its parser category.
      const chat: LlmChatFn = async () => ({
        success: true,
        model: "test",
        content: JSON.stringify({ items: [{ i: 1, kategoria: "health" }, { i: 3, kategoria: "rozrywka" }] })
      });

      const categories = await categorizeTransactionsWithLlm(transactions, { chat });
      assert.deepEqual(categories, ["health", "food", "entertainment"]);
    }
  },
  {
    name: "LLM categorizer falls back to deterministic categories when the model fails",
    async run() {
      const transactions = [
        { description: "ZAKUP PRZY UŻYCIU KARTY; ORLEN STACJA 12", merchant: "ORLEN STACJA 12", direction: "OUTFLOW" as const, amount: 250, category: "transport" as const },
        { description: "PRZELEW ZEWNĘTRZNY PRZYCHODZĄCY; ANNA NOWAK", merchant: "ANNA NOWAK", direction: "INFLOW" as const, amount: 300, category: "people_transfers" as const }
      ];

      const chat: LlmChatFn = async () => ({ success: false, error: { code: "network_error", message: "offline" } });

      const categories = await categorizeTransactionsWithLlm(transactions, { chat });
      assert.deepEqual(categories, ["transport", "people_transfers"]);
    }
  },
  {
    name: "confirmed statement supersedes daily-notification transactions booked in its period",
    async run() {
      const { db, state } = createImportHarness();

      // A daily-notification transfer already imported for 2026-06-14 (also present in the statement).
      const dailyBatch = await db.importBatch.create({
        data: { gmailMessageId: "daily-msg", operationDate: new Date("2026-06-14T00:00:00.000Z"), status: "IMPORTED", transactionCount: 1 }
      });
      await db.bankTransaction.createMany({
        data: [
          {
            importBatchId: dailyBatch.id,
            operationDate: new Date("2026-06-14T00:00:00.000Z"),
            bookingDate: new Date("2026-06-14T00:00:00.000Z"),
            amount: 300,
            currency: "PLN",
            direction: "INFLOW",
            description: "PRZELEW",
            merchant: "MONIKA",
            category: "people_transfers"
          }
        ]
      });

      const parsed = parseMbankStatement(mbankStatementRowsFixture());
      const statementBatch = await db.importBatch.create({
        data: {
          provider: "MBANK_STATEMENT",
          gmailMessageId: "statement-msg",
          operationDate: parsed.periodEnd,
          periodStart: parsed.periodStart,
          periodEnd: parsed.periodEnd,
          status: "PENDING_REVIEW",
          transactionCount: parsed.transactions.length,
          parsedTransactions: parsed.transactions.map((transaction) => ({
            operationDate: transaction.operationDate.toISOString(),
            bookingDate: transaction.bookingDate ? transaction.bookingDate.toISOString() : null,
            amount: transaction.amount,
            currency: transaction.currency,
            direction: transaction.direction,
            description: transaction.description,
            merchant: transaction.merchant,
            category: transaction.category
          }))
        }
      });

      const confirmed = await confirmImportBatch(db, statementBatch.id);
      assert.equal(confirmed.created, 4);
      assert.equal("superseded" in confirmed ? confirmed.superseded : -1, 1);

      // The old daily transfer is gone; only the statement's four transactions remain.
      assert.equal(state.transactions.length, 4);
      assert.ok(state.transactions.every((transaction) => transaction.importBatchId === statementBatch.id));
      // The superseded daily batch count is refreshed to zero.
      assert.equal(state.batches.find((batch) => batch.id === dailyBatch.id)?.transactionCount, 0);
    }
  },
  {
    name: "daily-notification import skips transactions already covered by an imported statement",
    async run() {
      const { db, state } = createImportHarness();
      const parsed = parseMbankStatement(mbankStatementRowsFixture());

      await db.importBatch.create({
        data: {
          provider: "MBANK_STATEMENT",
          gmailMessageId: "statement-msg",
          operationDate: parsed.periodEnd,
          periodStart: parsed.periodStart,
          periodEnd: parsed.periodEnd,
          status: "IMPORTED",
          transactionCount: parsed.transactions.length
        }
      });

      const dailyBatch = await db.importBatch.create({
        data: {
          gmailMessageId: "daily-msg",
          operationDate: new Date("2026-06-14T00:00:00.000Z"),
          status: "PENDING_REVIEW",
          transactionCount: 1,
          parsedTransactions: [
            {
              operationDate: "2026-06-14T00:00:00.000Z",
              bookingDate: "2026-06-14T00:00:00.000Z",
              amount: 300,
              currency: "PLN",
              direction: "INFLOW",
              description: "PRZELEW",
              merchant: "MONIKA",
              category: "people_transfers"
            }
          ]
        }
      });

      const confirmed = await confirmImportBatch(db, dailyBatch.id);
      assert.equal(confirmed.created, 0);
      assert.equal(state.transactions.length, 0);
      assert.equal(state.batches.find((batch) => batch.id === dailyBatch.id)?.status, "IMPORTED");
    }
  },
  {
    name: "mBank import skips non-transaction mBank notification emails",
    async run() {
      const { db, state } = createImportHarness();
      const summary: GmailMessageSummary = {
        id: "msg-notification-1",
        threadId: "thread-notification",
        subject: "mBank - powiadomienie e-mail",
        sender: "mBank",
        receivedAt: new Date("2026-07-02T08:00:00.000Z"),
        snippet: "mBank"
      };
      const adapter = {
        searchMbankMessages: async () => [summary],
        readGmailMessage: async () => ({ ...summary, bodyText: "mBank\nData: 02.07.2026\nTo jest powiadomienie e-mail bez szczegolow transakcji." })
      };

      const sync = await syncMbankGmail(db, { adapter, traceId: "skip-notification-sync", categorize: deterministicCategorize });
      assert.equal(sync.skipped, 1);
      assert.equal(sync.failed, 0);
      assert.equal(state.batches.length, 1);
      assert.equal(state.batches[0]?.status, "SKIPPED");
      assert.match(String(state.batches[0]?.errorMessage), /non-transaction/);
    }
  },
  {
    name: "mBank retry parse updates failed batch without creating transactions",
    async run() {
      const { db, state } = createImportHarness();
      const summary: GmailMessageSummary = {
        id: "msg-retry-1",
        threadId: "thread-retry",
        subject: "mBank - broken",
        sender: "mBank",
        receivedAt: new Date("2026-07-02T08:00:00.000Z"),
        snippet: "mBank"
      };
      const brokenAdapter = {
        searchMbankMessages: async () => [summary],
        readGmailMessage: async () => ({ ...summary, bodyText: "mBank message without operation date" })
      };

      const failedSync = await syncMbankGmail(db, { adapter: brokenAdapter, traceId: "retry-sync", categorize: deterministicCategorize });
      assert.equal(failedSync.failed, 1);
      assert.equal(state.batches.length, 1);
      assert.equal(state.batches[0]?.status, "FAILED");

      const retry = await retryParseImportBatch(db, String(state.batches[0]?.id), {
        adapter: {
          readGmailMessage: async () => ({ ...summary, subject: "mBank - fixed", bodyText: mbankFixture() })
        },
        traceId: "retry-parse"
      });

      assert.equal(retry.status, "pending_review");
      assert.equal(retry.transactionCount, 1);
      assert.equal(state.batches[0]?.status, "PENDING_REVIEW");
      assert.equal(state.transactions.length, 0);
    }
  },
  {
    name: "syncMbankGmail respects syncMode by filtering out the other message type before processing",
    async run() {
      const dailySummary: GmailMessageSummary = {
        id: "msg-daily-1",
        threadId: "thread-daily",
        subject: null,
        sender: "mBank",
        receivedAt: new Date("2026-07-02T08:00:00.000Z"),
        snippet: "mBank"
      };
      const statementSummary: GmailMessageSummary = {
        id: "msg-statement-1",
        threadId: "thread-statement",
        subject: null,
        sender: "mBank",
        receivedAt: new Date("2026-07-05T08:00:00.000Z"),
        snippet: "mBank"
      };
      const adapter = {
        searchMbankMessages: async () => [dailySummary, statementSummary],
        readGmailMessage: async (message: GmailMessageSummary) =>
          message.id === dailySummary.id
            ? { ...dailySummary, subject: "mBank - powiadomienie e-mail", bodyText: mbankFixture() }
            : { ...statementSummary, subject: "mBank - elektroniczne zestawienie operacji za czerwiec 2026", bodyText: "irrelevant" },
        readGmailPdfAttachments: async () => []
      };

      const { db: dailyOnlyDb, state: dailyOnlyState } = createImportHarness();
      await syncMbankGmail(dailyOnlyDb, { adapter, traceId: "daily-only", categorize: deterministicCategorize, syncMode: "DAILY_ONLY" });
      assert.equal(dailyOnlyState.batches.length, 1);
      assert.equal(dailyOnlyState.batches[0]?.gmailMessageId, dailySummary.id);

      const { db: statementOnlyDb, state: statementOnlyState } = createImportHarness();
      await syncMbankGmail(statementOnlyDb, { adapter, traceId: "statement-only", categorize: deterministicCategorize, syncMode: "STATEMENT_ONLY" });
      assert.equal(statementOnlyState.batches.length, 1);
      assert.equal(statementOnlyState.batches[0]?.gmailMessageId, statementSummary.id);
      assert.equal(statementOnlyState.batches[0]?.provider, "MBANK_STATEMENT");

      const { db: bothDb, state: bothState } = createImportHarness();
      await syncMbankGmail(bothDb, { adapter, traceId: "both", categorize: deterministicCategorize, syncMode: "BOTH" });
      assert.equal(bothState.batches.length, 2);
    }
  },
  {
    name: "createFailedBatch tags a failed statement email with the MBANK_STATEMENT provider",
    async run() {
      const { db, state } = createImportHarness();
      const summary: GmailMessageSummary = {
        id: "msg-statement-broken",
        threadId: "thread-statement",
        subject: "mBank - elektroniczne zestawienie operacji za czerwiec 2026",
        sender: "mBank",
        receivedAt: new Date("2026-07-01T08:00:00.000Z"),
        snippet: "mBank"
      };
      const brokenAdapter = {
        searchMbankMessages: async () => [summary],
        readGmailMessage: async () => ({ ...summary, bodyText: "irrelevant" }),
        readGmailPdfAttachments: async () => []
      };

      const result = await syncMbankGmail(db, { adapter: brokenAdapter, traceId: "statement-fail-sync", categorize: deterministicCategorize });
      assert.equal(result.failed, 1);
      assert.equal(state.batches.length, 1);
      assert.equal(state.batches[0]?.status, "FAILED");
      assert.equal(state.batches[0]?.provider, "MBANK_STATEMENT");
    }
  },
  {
    name: "retryParseImportBatch retries a failed statement batch through the PDF path, not the email parser",
    async run() {
      const { db, state } = createImportHarness();

      const failed = await db.importBatch.create({
        data: {
          provider: "MBANK_STATEMENT",
          gmailMessageId: "msg-statement-retry",
          subject: "mBank - elektroniczne zestawienie operacji za czerwiec 2026",
          status: "FAILED",
          errorMessage: "Could not open the mBank statement PDF: Setting up fake worker failed."
        }
      });
      const message = { id: failed.gmailMessageId, threadId: null, subject: failed.subject, sender: null, receivedAt: null, bodyText: "irrelevant" };

      const noAdapterRetry = await retryParseImportBatch(db, failed.id, {
        adapter: { readGmailMessage: async () => message },
        traceId: "statement-retry-no-adapter"
      });
      assert.equal(noAdapterRetry.status, "failed");
      assert.match(noAdapterRetry.message, /cannot read PDF attachments/);
      assert.equal(state.batches[0]?.status, "FAILED");

      const noPdfRetry = await retryParseImportBatch(db, failed.id, {
        adapter: { readGmailMessage: async () => message, readGmailPdfAttachments: async () => [] },
        traceId: "statement-retry-no-pdf"
      });
      assert.equal(noPdfRetry.status, "failed");
      assert.match(noPdfRetry.message, /no PDF attachment/);
    }
  },
  {
    name: "mBank import dedupe key is provider Gmail message and operation date",
    run() {
      const keyA = createImportDedupeKey({ provider: "MBANK_EMAIL", gmailMessageId: "abc", operationDate: new Date("2026-07-02T00:00:00.000Z") });
      const keyB = createImportDedupeKey({ provider: "MBANK_EMAIL", gmailMessageId: "abc", operationDate: new Date("2026-07-02T12:34:00.000Z") });
      const keyC = createImportDedupeKey({ provider: "MBANK_EMAIL", gmailMessageId: "def", operationDate: new Date("2026-07-02T00:00:00.000Z") });

      assert.equal(keyA, keyB);
      assert.notEqual(keyA, keyC);
    }
  },
  {
    name: "report critic flags prohibited financial actions",
    run() {
      const portfolio = analysePortfolio(sampleContext);
      const report = buildReportDraft(sampleContext, portfolio, reviewRisks(sampleContext));
      const verdict = critiqueReport({ ...report, markdown: `${report.markdown}
wykonaj przelew teraz` });

      assert.equal(verdict.verdict, "NEEDS_REVIEW");
      assert.match(verdict.notes.join(" "), /niedozwoloną/);
    }
  },

  {
    name: "retention cleanup reports zero transaction deletion and only clears disposable records",
    async run() {
      const calls: string[] = [];
      const deleteMany = (model: string) => async () => {
        calls.push(model);
        return { count: 1 };
      };
      const db = {
        agentRun: {
          findMany: async () => [{ id: "old-run-1" }],
          deleteMany: deleteMany("agentRun")
        },
        traceSpan: { deleteMany: deleteMany("traceSpan") },
        runEvent: { deleteMany: deleteMany("runEvent") },
        report: { deleteMany: deleteMany("report") },
        $transaction: async (operations: Array<Promise<{ count: number }>>) => Promise.all(operations)
      } as unknown as PrismaClient;

      const result = await cleanupRetainedData(db, { now: new Date("2026-07-06T10:00:00.000Z"), days: 90 });

      assert.equal(result.transactionsDeleted, 0);
      assert.deepEqual(calls.sort(), ["agentRun", "report", "runEvent", "traceSpan"].sort());
    }
  },
  {
    name: "daily scheduler calculates next local morning slot",
    run() {
      const next = calculateNextDailyRun(new Date("2026-07-03T07:30:00"), "08:00");
      assert.equal(next.getHours(), 8);
      assert.equal(next.getMinutes(), 0);
    }
  }
];

async function main() {
  for (const test of tests) {
    await test.run();
    console.log(`ok - ${test.name}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
