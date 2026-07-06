CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "AccountProvider" AS ENUM ('BINANCE', 'XTB', 'BANK', 'MANUAL');
CREATE TYPE "AssetClass" AS ENUM ('CASH', 'ETF_STOCK', 'STOCK', 'BOND', 'CRYPTO', 'COMMODITY', 'OTHER');
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW');
CREATE TYPE "EventLevel" AS ENUM ('INFO', 'WARN', 'ERROR');
CREATE TYPE "ObservationPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'COMPLETED');
CREATE TYPE "CriticVerdict" AS ENUM ('PASS', 'NEEDS_REVIEW', 'FAIL');

CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "provider" "AccountProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'PLN',
    "readOnly" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetClass" "AssetClass" NOT NULL,
    "currency" TEXT NOT NULL,
    "sector" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "quantity" DECIMAL(24,8) NOT NULL,
    "marketPrice" DECIMAL(24,8) NOT NULL,
    "marketValueBase" DECIMAL(24,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PortfolioSnapshot" (
    "id" TEXT NOT NULL,
    "sourceRunId" TEXT,
    "asOf" TIMESTAMP(3) NOT NULL,
    "totalValueBase" DECIMAL(24,2) NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'PLN',
    "allocations" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortfolioSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "inputSummary" JSONB,
    "outputSummary" JSONB,
    "errorMessage" TEXT,
    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "level" "EventLevel" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RunEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "allocation" JSONB NOT NULL,
    "riskFlags" JSONB NOT NULL,
    "opportunities" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "rebalancingPlan" JSONB NOT NULL,
    "unknowns" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "criticVerdict" "CriticVerdict" NOT NULL DEFAULT 'PASS',
    "markdown" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ObservationRecord" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "dataSourcesUsed" JSONB NOT NULL,
    "missingData" JSONB NOT NULL,
    "portfolioSnapshotSummary" JSONB NOT NULL,
    "reportSummary" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "riskFlags" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ObservationRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "recordId" TEXT,
    "threadId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "priority" "ObservationPriority" NOT NULL,
    "topic" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sourceLinks" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Reflection" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "topics" JSONB NOT NULL,
    "sourceObservationIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Reflection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Asset_symbol_key" ON "Asset"("symbol");
CREATE INDEX "Position_accountId_idx" ON "Position"("accountId");
CREATE INDEX "Position_assetId_idx" ON "Position"("assetId");
CREATE INDEX "Position_asOf_idx" ON "Position"("asOf");
CREATE INDEX "AgentRun_threadId_idx" ON "AgentRun"("threadId");
CREATE INDEX "AgentRun_resourceId_idx" ON "AgentRun"("resourceId");
CREATE INDEX "AgentRun_startedAt_idx" ON "AgentRun"("startedAt");
CREATE INDEX "RunEvent_runId_idx" ON "RunEvent"("runId");
CREATE INDEX "RunEvent_step_idx" ON "RunEvent"("step");
CREATE UNIQUE INDEX "Report_runId_key" ON "Report"("runId");
CREATE UNIQUE INDEX "ObservationRecord_runId_key" ON "ObservationRecord"("runId");
CREATE INDEX "ObservationRecord_threadId_idx" ON "ObservationRecord"("threadId");
CREATE INDEX "ObservationRecord_resourceId_idx" ON "ObservationRecord"("resourceId");
CREATE INDEX "Observation_threadId_idx" ON "Observation"("threadId");
CREATE INDEX "Observation_resourceId_idx" ON "Observation"("resourceId");
CREATE INDEX "Observation_priority_idx" ON "Observation"("priority");
CREATE INDEX "Observation_topic_idx" ON "Observation"("topic");
CREATE INDEX "Reflection_threadId_idx" ON "Reflection"("threadId");
CREATE INDEX "Reflection_resourceId_idx" ON "Reflection"("resourceId");

ALTER TABLE "Position" ADD CONSTRAINT "Position_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Position" ADD CONSTRAINT "Position_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunEvent" ADD CONSTRAINT "RunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ObservationRecord" ADD CONSTRAINT "ObservationRecord_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ObservationRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
