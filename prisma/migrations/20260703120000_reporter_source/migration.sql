ALTER TABLE "Report" ADD COLUMN "reporterSource" TEXT NOT NULL DEFAULT 'deterministic';
ALTER TABLE "Report" ADD COLUMN "reporterModel" TEXT;
