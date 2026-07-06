"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { runPortfolioAnalysis } from "@/domain/workflows/run-analysis";
import { LOCAL_RESOURCE_ID, defaultStrategy } from "@/domain/portfolio/strategy";
import { confirmImportBatch, rejectImportBatch, retryParseImportBatch, syncMbankGmail, updateBankTransactionCategory, updateImportPreviewTransactionCategory } from "@/domain/imports/mbank-import-pipeline";
import { writeImportObservation } from "@/domain/memory/observational-memory";
import { runDailySchedulerTick } from "@/domain/scheduler/daily-scheduler";
import { cleanupRetainedData } from "@/domain/retention/cleanup";
import { sendGlobalChatMessage } from "@/domain/chat/global-chat";
import { resolveAllowedLocalLlmModel } from "@/lib/llm/model-presets";

export type ActionResult = {
  status: "idle" | "success" | "error";
  message: string;
  detail?: string;
  timestamp?: number;
};

function result(status: ActionResult["status"], message: string, detail?: string): ActionResult {
  return { status, message, detail, timestamp: Date.now() };
}

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function splitTextarea(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function runAnalysisAction(_previousState: ActionResult, formData: FormData): Promise<ActionResult> {
  void _previousState;

  try {
    const run = await runPortfolioAnalysis(prisma, {
      llmModel: resolveAllowedLocalLlmModel(formData.get("llmModel")),
      reportType: "ON_DEMAND"
    });
    revalidatePath("/");

    return result("success", "Analysis completed and report saved.", `Run ${run.id} finished with status ${run.status}.`);
  } catch (error) {
    return result("error", "Analysis failed.", error instanceof Error ? error.message : "Unknown analysis error.");
  }
}

const strategyFormSchema = z.object({
  profile: z.string().trim().min(2).max(80),
  age: z.union([z.literal(""), z.coerce.number().int().min(0).max(120)]).optional(),
  lifeStage: z.string().trim().min(2).max(80),
  investmentHorizonYears: z.coerce.number().int().min(1).max(80),
  riskTolerance: z.enum(["low", "medium", "high", "very_high"]),
  monthlyIncome: z.union([z.literal(""), z.coerce.number().min(0).max(100_000_000)]).optional(),
  monthlyFixedCosts: z.union([z.literal(""), z.coerce.number().min(0).max(100_000_000)]).optional(),
  monthlyInvestmentCapacity: z.union([z.literal(""), z.coerce.number().min(0).max(100_000_000)]).optional(),
  goals: z.string().trim().max(3000),
  constraints: z.string().trim().max(3000),
  preferredReportLength: z.enum(["short", "medium", "long"]),
  preferredReportLanguage: z.enum(["pl", "en"]),
  CASH: z.coerce.number().min(0).max(100),
  ETF_STOCK: z.coerce.number().min(0).max(100),
  STOCK: z.coerce.number().min(0).max(100),
  BOND: z.coerce.number().min(0).max(100),
  CRYPTO: z.coerce.number().min(0).max(100),
  COMMODITY: z.coerce.number().min(0).max(100),
  OTHER: z.coerce.number().min(0).max(100),
  maxSinglePositionPercent: z.coerce.number().min(1).max(100),
  maxCryptoPercent: z.coerce.number().min(0).max(100),
  minCashPercent: z.coerce.number().min(0).max(100)
}).refine(
  (value) =>
    Math.abs(
      value.CASH + value.ETF_STOCK + value.STOCK + value.BOND + value.CRYPTO + value.COMMODITY + value.OTHER - 100
    ) < 0.001,
  { message: "Target allocation guardrails must sum to 100%." }
);

function optionalNumber(value: number | "" | undefined) {
  return value === "" || value === undefined ? null : value;
}

export async function updateStrategyAction(_previousState: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = strategyFormSchema.safeParse({
    profile: formData.get("profile"),
    age: formData.get("age"),
    lifeStage: formData.get("lifeStage"),
    investmentHorizonYears: formData.get("investmentHorizonYears"),
    riskTolerance: formData.get("riskTolerance"),
    monthlyIncome: formData.get("monthlyIncome"),
    monthlyFixedCosts: formData.get("monthlyFixedCosts"),
    monthlyInvestmentCapacity: formData.get("monthlyInvestmentCapacity"),
    goals: formData.get("goals"),
    constraints: formData.get("constraints"),
    preferredReportLength: formData.get("preferredReportLength"),
    preferredReportLanguage: formData.get("preferredReportLanguage"),
    CASH: formData.get("CASH"),
    ETF_STOCK: formData.get("ETF_STOCK"),
    STOCK: formData.get("STOCK"),
    BOND: formData.get("BOND"),
    CRYPTO: formData.get("CRYPTO"),
    COMMODITY: formData.get("COMMODITY"),
    OTHER: formData.get("OTHER"),
    maxSinglePositionPercent: formData.get("maxSinglePositionPercent"),
    maxCryptoPercent: formData.get("maxCryptoPercent"),
    minCashPercent: formData.get("minCashPercent")
  });

  if (!parsed.success) {
    return result("error", "Profile was not saved.", parsed.error.issues[0]?.message ?? "Check the profile form values.");
  }

  try {
    const values = parsed.data;
    const goals = splitTextarea(values.goals);
    const constraints = splitTextarea(values.constraints);

    await prisma.$transaction([
      prisma.userFinancialProfile.upsert({
        where: { resourceId: LOCAL_RESOURCE_ID },
        update: {
          age: optionalNumber(values.age),
          lifeStage: values.lifeStage,
          baseCurrency: "PLN",
          investmentHorizonYears: values.investmentHorizonYears,
          riskTolerance: values.riskTolerance.toUpperCase() as "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH",
          monthlyIncome: optionalNumber(values.monthlyIncome),
          monthlyFixedCosts: optionalNumber(values.monthlyFixedCosts),
          monthlyInvestmentCapacity: optionalNumber(values.monthlyInvestmentCapacity),
          goals,
          constraints,
          preferredReportLength: values.preferredReportLength,
          preferredReportLanguage: values.preferredReportLanguage
        },
        create: {
          resourceId: LOCAL_RESOURCE_ID,
          age: optionalNumber(values.age),
          lifeStage: values.lifeStage,
          baseCurrency: "PLN",
          investmentHorizonYears: values.investmentHorizonYears,
          riskTolerance: values.riskTolerance.toUpperCase() as "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH",
          monthlyIncome: optionalNumber(values.monthlyIncome),
          monthlyFixedCosts: optionalNumber(values.monthlyFixedCosts),
          monthlyInvestmentCapacity: optionalNumber(values.monthlyInvestmentCapacity),
          goals: goals.length > 0 ? goals : defaultStrategy.goals,
          constraints: constraints.length > 0 ? constraints : defaultStrategy.constraints,
          preferredReportLength: values.preferredReportLength,
          preferredReportLanguage: values.preferredReportLanguage
        }
      }),
      prisma.strategySettings.upsert({
        where: { resourceId: LOCAL_RESOURCE_ID },
        update: {
          profile: values.profile,
          baseCurrency: "PLN",
          preferredReportLanguage: values.preferredReportLanguage,
          targetAllocation: {
            CASH: values.CASH,
            ETF_STOCK: values.ETF_STOCK,
            STOCK: values.STOCK,
            BOND: values.BOND,
            CRYPTO: values.CRYPTO,
            COMMODITY: values.COMMODITY,
            OTHER: values.OTHER
          },
          maxSinglePositionPercent: values.maxSinglePositionPercent,
          maxCryptoPercent: values.maxCryptoPercent,
          minCashPercent: values.minCashPercent,
          privacyRules: {
            anonymizePersonalData: false,
            sendOnlyAggregatesToLlm: false
          }
        },
        create: {
          resourceId: LOCAL_RESOURCE_ID,
          profile: values.profile,
          baseCurrency: "PLN",
          preferredReportLanguage: values.preferredReportLanguage,
          targetAllocation: {
            CASH: values.CASH,
            ETF_STOCK: values.ETF_STOCK,
            STOCK: values.STOCK,
            BOND: values.BOND,
            CRYPTO: values.CRYPTO,
            COMMODITY: values.COMMODITY,
            OTHER: values.OTHER
          },
          maxSinglePositionPercent: values.maxSinglePositionPercent,
          maxCryptoPercent: values.maxCryptoPercent,
          minCashPercent: values.minCashPercent,
          privacyRules: {
            anonymizePersonalData: false,
            sendOnlyAggregatesToLlm: false
          }
        }
      })
    ]);

    revalidatePath("/");

    return result("success", "Profile saved.", "The next analysis run will use the updated local profile.");
  } catch (error) {
    return result("error", "Profile was not saved.", error instanceof Error ? error.message : "Unknown database error.");
  }
}

export async function syncMbankGmailAction(_previousState: ActionResult): Promise<ActionResult> {
  void _previousState;

  try {
    const sync = await syncMbankGmail(prisma);
    await writeImportObservation(prisma, {
      resourceId: LOCAL_RESOURCE_ID,
      topic: "gmail-sync",
      content: sync.message,
      priority: sync.status === "completed" ? "COMPLETED" : "MEDIUM"
    });
    revalidatePath("/");
    return result("success", "mBank Gmail sync finished.", sync.message);
  } catch (error) {
    return result("error", "mBank Gmail sync failed.", error instanceof Error ? error.message : "Unknown import error.");
  }
}

export async function confirmImportAction(_previousState: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const batchId = formString(formData, "batchId");
    const confirmed = await confirmImportBatch(prisma, batchId);
    await writeImportObservation(prisma, {
      resourceId: LOCAL_RESOURCE_ID,
      batchId,
      topic: "import-confirmed",
      content: `Confirmed import batch ${batchId}; created ${confirmed.created} transaction(s).`,
      priority: "COMPLETED"
    });
    revalidatePath("/");
    return result("success", "Import confirmed.", `Created ${confirmed.created} transaction(s).`);
  } catch (error) {
    return result("error", "Import was not confirmed.", error instanceof Error ? error.message : "Unknown import error.");
  }
}

export async function rejectImportAction(_previousState: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const batchId = formString(formData, "batchId");
    await rejectImportBatch(prisma, batchId);
    await writeImportObservation(prisma, {
      resourceId: LOCAL_RESOURCE_ID,
      batchId,
      topic: "import-rejected",
      content: `Rejected import batch ${batchId}.`,
      priority: "LOW"
    });
    revalidatePath("/");
    return result("success", "Import rejected.", "The pending preview was marked as skipped.");
  } catch (error) {
    return result("error", "Import was not rejected.", error instanceof Error ? error.message : "Unknown import error.");
  }
}

export async function retryImportParseAction(_previousState: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const batchId = formString(formData, "batchId");
    const retry = await retryParseImportBatch(prisma, batchId);
    await writeImportObservation(prisma, {
      resourceId: LOCAL_RESOURCE_ID,
      batchId,
      topic: "import-retry",
      content: `Retried import batch ${batchId}; result ${retry.status}; parsed ${retry.transactionCount} transaction(s).`,
      priority: retry.status === "pending_review" ? "COMPLETED" : "MEDIUM"
    });
    revalidatePath("/");
    return result(
      retry.status === "failed" ? "error" : "success",
      retry.status === "pending_review" ? "Import parsed again." : retry.status === "duplicate" ? "Import is a duplicate." : "Import retry failed.",
      retry.message
    );
  } catch (error) {
    return result("error", "Import retry failed.", error instanceof Error ? error.message : "Unknown import error.");
  }
}

export async function updateImportPreviewCategoryAction(_previousState: ActionResult, formData: FormData): Promise<ActionResult> {
  void _previousState;

  try {
    const batchId = formString(formData, "batchId");
    const category = formString(formData, "category");
    const transactionIndex = Number(formString(formData, "transactionIndex"));

    if (!batchId || !Number.isInteger(transactionIndex)) {
      return result("error", "Category was not saved.", "Missing import batch or transaction index.");
    }

    await updateImportPreviewTransactionCategory(prisma, batchId, transactionIndex, category);
    revalidatePath("/");
    return result("success", "Category saved.", "The import preview was updated.");
  } catch (error) {
    return result("error", "Category was not saved.", error instanceof Error ? error.message : "Unknown category update error.");
  }
}

export async function updateTransactionCategoryAction(_previousState: ActionResult, formData: FormData): Promise<ActionResult> {
  void _previousState;

  try {
    const transactionId = formString(formData, "transactionId");
    const category = formString(formData, "category");

    if (!transactionId) {
      return result("error", "Category was not saved.", "Missing transaction id.");
    }

    await updateBankTransactionCategory(prisma, transactionId, category);
    revalidatePath("/");
    return result("success", "Category saved.", "The transaction was updated.");
  } catch (error) {
    return result("error", "Category was not saved.", error instanceof Error ? error.message : "Unknown category update error.");
  }
}

export async function sendChatMessageAction(_previousState: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const content = formString(formData, "content");
    const chat = await sendGlobalChatMessage(prisma, {
      content,
      llmModel: resolveAllowedLocalLlmModel(formData.get("llmModel"))
    });
    revalidatePath("/");

    if (!chat.success) {
      return result("error", "Local chat failed.", chat.error.message);
    }

    return result("success", "Message sent.", `Answered with ${chat.model}.`);
  } catch (error) {
    return result("error", "Message was not sent.", error instanceof Error ? error.message : "Unknown chat error.");
  }
}

export async function runSchedulerNowAction(_previousState: ActionResult): Promise<ActionResult> {
  void _previousState;

  try {
    const scheduler = await runDailySchedulerTick(prisma, { force: true });
    revalidatePath("/");
    return result("success", "Scheduler tick finished.", scheduler.message);
  } catch (error) {
    return result("error", "Scheduler tick failed.", error instanceof Error ? error.message : "Unknown scheduler error.");
  }
}

export async function cleanupRetentionAction(_previousState: ActionResult): Promise<ActionResult> {
  void _previousState;

  try {
    const cleaned = await cleanupRetainedData(prisma);
    revalidatePath("/");
    return result(
      "success",
      "Retention cleanup finished.",
      `Deleted ${cleaned.runs} run(s), ${cleaned.reports} report(s), ${cleaned.runEvents} event(s), ${cleaned.traceSpans} trace span(s). Transactions deleted: ${cleaned.transactionsDeleted}.`
    );
  } catch (error) {
    return result("error", "Retention cleanup failed.", error instanceof Error ? error.message : "Unknown retention error.");
  }
}
