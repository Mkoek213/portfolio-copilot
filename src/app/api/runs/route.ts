import { NextResponse } from "next/server";
import { runPortfolioAnalysis } from "@/domain/workflows/run-analysis";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const run = await runPortfolioAnalysis(prisma);

  return NextResponse.json({
    runId: run.id,
    status: run.status,
    reportId: run.report?.id ?? null
  });
}
