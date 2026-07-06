import type { PrismaClient } from "@prisma/client";

export type TraceStepInput = {
  traceId: string;
  runId?: string | null;
  resourceId: string;
  name: string;
  input?: unknown;
  metadata?: unknown;
};

function jsonOrNull(value: unknown) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export async function traceStep<T>(db: PrismaClient, input: TraceStepInput, fn: () => Promise<T> | T): Promise<T> {
  const span = await db.traceSpan.create({
    data: {
      traceId: input.traceId,
      runId: input.runId ?? null,
      resourceId: input.resourceId,
      name: input.name,
      input: jsonOrNull(input.input),
      metadata: jsonOrNull(input.metadata)
    }
  });

  try {
    const result = await fn();
    await db.traceSpan.update({
      where: { id: span.id },
      data: {
        status: "OK",
        endedAt: new Date(),
        output: jsonOrNull(result)
      }
    });
    return result;
  } catch (error) {
    await db.traceSpan.update({
      where: { id: span.id },
      data: {
        status: "ERROR",
        level: "ERROR",
        endedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Unknown trace error"
      }
    });
    throw error;
  }
}

export async function recordTraceWarning(db: PrismaClient, input: TraceStepInput & { message: string }) {
  return db.traceSpan.create({
    data: {
      traceId: input.traceId,
      runId: input.runId ?? null,
      resourceId: input.resourceId,
      name: input.name,
      status: "WARN",
      level: "WARN",
      input: jsonOrNull(input.input),
      metadata: jsonOrNull(input.metadata),
      errorMessage: input.message,
      endedAt: new Date()
    }
  });
}
