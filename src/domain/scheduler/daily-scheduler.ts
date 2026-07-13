import type { PrismaClient } from "@prisma/client";
import { syncMbankGmail } from "@/domain/imports/mbank-import-pipeline";

export const DAILY_SCHEDULER_NAME = "mbank-daily-import";

export function calculateNextDailyRun(from = new Date(), timeOfDay = "08:00") {
  const [hour = 8, minute = 0] = timeOfDay.split(":").map((part) => Number(part));
  const next = new Date(from);
  next.setHours(hour, minute, 0, 0);

  if (next <= from) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

export async function ensureSchedulerState(db: PrismaClient) {
  const existing = await db.schedulerState.findUnique({ where: { name: DAILY_SCHEDULER_NAME } });

  if (existing) {
    return existing;
  }

  return db.schedulerState.create({
    data: {
      name: DAILY_SCHEDULER_NAME,
      enabled: true,
      timeOfDay: process.env.MBANK_DAILY_SYNC_TIME ?? "08:00",
      timezone: "Europe/Warsaw",
      nextRunAt: calculateNextDailyRun()
    }
  });
}

export async function runDailySchedulerTick(db: PrismaClient, options: { force?: boolean } = {}) {
  const state = await ensureSchedulerState(db);
  const now = new Date();

  if (!state.enabled && !options.force) {
    return { status: "disabled" as const, message: "Scheduler disabled." };
  }

  if (state.running) {
    return { status: "running" as const, message: "Scheduler is already running." };
  }

  if (!options.force && state.nextRunAt && state.nextRunAt > now) {
    return { status: "not_due" as const, message: "Scheduler is not due yet." };
  }

  await db.schedulerState.update({ where: { id: state.id }, data: { running: true, lastError: null } });

  try {
    const result = await syncMbankGmail(db, { traceId: `scheduler-${now.toISOString()}`, syncMode: state.syncMode });
    const nextRunAt = calculateNextDailyRun(now, state.timeOfDay);

    await db.schedulerState.update({
      where: { id: state.id },
      data: {
        running: false,
        lastRunAt: now,
        nextRunAt,
        lastStatus: result.message,
        lastError: null
      }
    });

    return { status: "completed" as const, message: result.message, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scheduler error.";
    await db.schedulerState.update({
      where: { id: state.id },
      data: {
        running: false,
        lastRunAt: now,
        nextRunAt: calculateNextDailyRun(now, state.timeOfDay),
        lastStatus: "failed",
        lastError: message
      }
    });

    return { status: "failed" as const, message };
  }
}
