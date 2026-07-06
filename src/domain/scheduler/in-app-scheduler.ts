import { prisma } from "@/lib/prisma";
import { runDailySchedulerTick } from "./daily-scheduler";

declare global {
  var __portfolioCopilotSchedulerStarted: boolean | undefined;
}

export function startInAppScheduler() {
  if (globalThis.__portfolioCopilotSchedulerStarted) {
    return;
  }

  globalThis.__portfolioCopilotSchedulerStarted = true;
  setInterval(() => {
    void runDailySchedulerTick(prisma).catch(() => undefined);
  }, 60_000).unref?.();
}
