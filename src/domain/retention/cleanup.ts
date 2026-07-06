import type { PrismaClient } from "@prisma/client";

export async function cleanupRetainedData(db: PrismaClient, options: { now?: Date; days?: number } = {}) {
  const now = options.now ?? new Date();
  const days = options.days ?? Number(process.env.DATA_RETENTION_DAYS ?? 90);
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);

  const oldRuns = await db.agentRun.findMany({
    where: { startedAt: { lt: cutoff } },
    select: { id: true }
  });
  const oldRunIds = oldRuns.map((run) => run.id);

  const [traceSpans, runEvents, reports, runs] = await db.$transaction([
    db.traceSpan.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    oldRunIds.length > 0 ? db.runEvent.deleteMany({ where: { runId: { in: oldRunIds } } }) : db.runEvent.deleteMany({ where: { id: { in: [] } } }),
    db.report.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    oldRunIds.length > 0 ? db.agentRun.deleteMany({ where: { id: { in: oldRunIds } } }) : db.agentRun.deleteMany({ where: { id: { in: [] } } })
  ]);

  return {
    cutoff,
    traceSpans: traceSpans.count,
    runEvents: runEvents.count,
    reports: reports.count,
    runs: runs.count,
    transactionsDeleted: 0
  };
}
