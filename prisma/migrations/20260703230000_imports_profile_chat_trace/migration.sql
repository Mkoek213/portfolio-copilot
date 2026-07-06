CREATE TYPE "ImportProvider" AS ENUM ('MBANK_EMAIL');
CREATE TYPE "ImportSource" AS ENUM ('GMAIL_MCP');
CREATE TYPE "ImportStatus" AS ENUM ('PENDING_REVIEW', 'IMPORTED', 'DUPLICATE', 'FAILED', 'SKIPPED');
CREATE TYPE "BankTransactionProvider" AS ENUM ('MBANK');
CREATE TYPE "BankTransactionSource" AS ENUM ('EMAIL');
CREATE TYPE "TransactionDirection" AS ENUM ('INFLOW', 'OUTFLOW');
CREATE TYPE "RiskTolerance" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH');
CREATE TYPE "ReportType" AS ENUM ('DAILY', 'MONTHLY', 'ON_DEMAND', 'INVESTMENT');
CREATE TYPE "TraceStatus" AS ENUM ('RUNNING', 'OK', 'WARN', 'ERROR');

ALTER TABLE "Report" ADD COLUMN "reportType" "ReportType" NOT NULL DEFAULT 'ON_DEMAND';

CREATE TABLE "UserFinancialProfile" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "age" INTEGER,
    "lifeStage" TEXT NOT NULL DEFAULT 'student',
    "baseCurrency" TEXT NOT NULL DEFAULT 'PLN',
    "investmentHorizonYears" INTEGER NOT NULL DEFAULT 15,
    "riskTolerance" "RiskTolerance" NOT NULL DEFAULT 'MEDIUM',
    "monthlyIncome" DECIMAL(24,2),
    "monthlyFixedCosts" DECIMAL(24,2),
    "monthlyInvestmentCapacity" DECIMAL(24,2),
    "goals" JSONB NOT NULL,
    "constraints" JSONB NOT NULL,
    "preferredReportLength" TEXT NOT NULL DEFAULT 'short',
    "preferredReportLanguage" TEXT NOT NULL DEFAULT 'pl',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserFinancialProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StrategySuggestion" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "sourceRunId" TEXT,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StrategySuggestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "provider" "ImportProvider" NOT NULL DEFAULT 'MBANK_EMAIL',
    "source" "ImportSource" NOT NULL DEFAULT 'GMAIL_MCP',
    "gmailMessageId" TEXT NOT NULL,
    "gmailThreadId" TEXT,
    "subject" TEXT,
    "sender" TEXT,
    "operationDate" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "parsedTransactions" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "provider" "BankTransactionProvider" NOT NULL DEFAULT 'MBANK',
    "source" "BankTransactionSource" NOT NULL DEFAULT 'EMAIL',
    "operationDate" TIMESTAMP(3) NOT NULL,
    "bookingDate" TIMESTAMP(3),
    "amount" DECIMAL(24,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PLN',
    "direction" "TransactionDirection" NOT NULL,
    "description" TEXT NOT NULL,
    "merchant" TEXT,
    "category" TEXT NOT NULL,
    "accountLabel" TEXT,
    "balanceAfter" DECIMAL(24,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatThread" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TraceSpan" (
    "id" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "parentSpanId" TEXT,
    "runId" TEXT,
    "resourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TraceStatus" NOT NULL DEFAULT 'RUNNING',
    "level" "EventLevel" NOT NULL DEFAULT 'INFO',
    "input" JSONB,
    "output" JSONB,
    "metadata" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TraceSpan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SchedulerState" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "timeOfDay" TEXT NOT NULL DEFAULT '08:00',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Warsaw',
    "running" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SchedulerState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserFinancialProfile_resourceId_key" ON "UserFinancialProfile"("resourceId");
CREATE INDEX "UserFinancialProfile_resourceId_idx" ON "UserFinancialProfile"("resourceId");
CREATE INDEX "StrategySuggestion_resourceId_idx" ON "StrategySuggestion"("resourceId");
CREATE INDEX "StrategySuggestion_sourceRunId_idx" ON "StrategySuggestion"("sourceRunId");
CREATE INDEX "StrategySuggestion_status_idx" ON "StrategySuggestion"("status");
CREATE UNIQUE INDEX "ImportBatch_provider_gmailMessageId_operationDate_key" ON "ImportBatch"("provider", "gmailMessageId", "operationDate");
CREATE INDEX "ImportBatch_status_idx" ON "ImportBatch"("status");
CREATE INDEX "ImportBatch_operationDate_idx" ON "ImportBatch"("operationDate");
CREATE INDEX "ImportBatch_createdAt_idx" ON "ImportBatch"("createdAt");
CREATE INDEX "BankTransaction_importBatchId_idx" ON "BankTransaction"("importBatchId");
CREATE INDEX "BankTransaction_operationDate_idx" ON "BankTransaction"("operationDate");
CREATE INDEX "BankTransaction_category_idx" ON "BankTransaction"("category");
CREATE INDEX "BankTransaction_direction_idx" ON "BankTransaction"("direction");
CREATE INDEX "BankTransaction_merchant_idx" ON "BankTransaction"("merchant");
CREATE INDEX "ChatThread_resourceId_idx" ON "ChatThread"("resourceId");
CREATE INDEX "ChatThread_updatedAt_idx" ON "ChatThread"("updatedAt");
CREATE INDEX "ChatMessage_threadId_idx" ON "ChatMessage"("threadId");
CREATE INDEX "ChatMessage_createdAt_idx" ON "ChatMessage"("createdAt");
CREATE INDEX "TraceSpan_traceId_idx" ON "TraceSpan"("traceId");
CREATE INDEX "TraceSpan_runId_idx" ON "TraceSpan"("runId");
CREATE INDEX "TraceSpan_resourceId_idx" ON "TraceSpan"("resourceId");
CREATE INDEX "TraceSpan_name_idx" ON "TraceSpan"("name");
CREATE INDEX "TraceSpan_startedAt_idx" ON "TraceSpan"("startedAt");
CREATE UNIQUE INDEX "SchedulerState_name_key" ON "SchedulerState"("name");

ALTER TABLE "StrategySuggestion" ADD CONSTRAINT "StrategySuggestion_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TraceSpan" ADD CONSTRAINT "TraceSpan_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
