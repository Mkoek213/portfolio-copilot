-- CreateTable
CREATE TABLE "CategoryBudget" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(24,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PLN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CategoryBudget_resourceId_idx" ON "CategoryBudget"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryBudget_resourceId_category_key" ON "CategoryBudget"("resourceId", "category");
