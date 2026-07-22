-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "categorySource" TEXT NOT NULL DEFAULT 'deterministic';

-- CreateTable
CREATE TABLE "CategoryRule" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "direction" "TransactionDirection" NOT NULL,
    "category" TEXT NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CategoryRule_resourceId_idx" ON "CategoryRule"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryRule_resourceId_matchKey_direction_key" ON "CategoryRule"("resourceId", "matchKey", "direction");
