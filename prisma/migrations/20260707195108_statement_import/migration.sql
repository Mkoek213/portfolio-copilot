-- AlterEnum
ALTER TYPE "BankTransactionSource" ADD VALUE 'STATEMENT';

-- AlterEnum
ALTER TYPE "ImportProvider" ADD VALUE 'MBANK_STATEMENT';

-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "periodEnd" TIMESTAMP(3),
ADD COLUMN     "periodStart" TIMESTAMP(3);
