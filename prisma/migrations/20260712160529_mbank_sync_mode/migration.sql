-- CreateEnum
CREATE TYPE "MbankSyncMode" AS ENUM ('DAILY_ONLY', 'STATEMENT_ONLY', 'BOTH');

-- AlterTable
ALTER TABLE "SchedulerState" ADD COLUMN     "syncMode" "MbankSyncMode" NOT NULL DEFAULT 'BOTH';
