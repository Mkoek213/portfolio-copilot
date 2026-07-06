CREATE TABLE "StrategySettings" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "profile" TEXT NOT NULL DEFAULT 'balanced-growth',
    "baseCurrency" TEXT NOT NULL DEFAULT 'PLN',
    "targetAllocation" JSONB NOT NULL,
    "maxSinglePositionPercent" DECIMAL(5,2) NOT NULL,
    "maxCryptoPercent" DECIMAL(5,2) NOT NULL,
    "minCashPercent" DECIMAL(5,2) NOT NULL,
    "preferredReportLanguage" TEXT NOT NULL DEFAULT 'pl',
    "privacyRules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StrategySettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StrategySettings_resourceId_key" ON "StrategySettings"("resourceId");
CREATE INDEX "StrategySettings_resourceId_idx" ON "StrategySettings"("resourceId");
