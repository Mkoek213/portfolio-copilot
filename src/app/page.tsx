import type { Prisma } from "@prisma/client";
import {
  AlertTriangle,
  Banknote,
  Bot,
  Brain,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  History,
  Import,
  MessageSquare,
  PieChart,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  WalletCards,
  XCircle
} from "lucide-react";
import { ChatPanel } from "./components/chat-panel";
import { ImportBatchActions, ImportPreviewCategoryControl, SyncMbankControl, TransactionCategoryControl } from "./components/import-controls";
import { RetentionCleanupControl, SchedulerNowControl } from "./components/maintenance-controls";
import { RunAnalysisControl } from "./components/run-analysis-control";
import { StrategySettingsForm } from "./components/strategy-settings-form";
import { prisma } from "@/lib/prisma";
import { defaultStrategy, strategyFromSettings } from "@/domain/portfolio/strategy";
import { checkGmailMcpHealth } from "@/domain/imports/gmail-mcp-adapter";
import { ensureSchedulerState } from "@/domain/scheduler/daily-scheduler";
import { startInAppScheduler } from "@/domain/scheduler/in-app-scheduler";
import { getOrCreateGlobalChatThread } from "@/domain/chat/global-chat";
import { checkLocalLlmHealth, getLocalLlmConfig } from "@/lib/llm/local-llm-client";
import { LOCAL_LLM_MODEL_PRESETS } from "@/lib/llm/model-presets";
import { checkLocalLangfuseStatus } from "@/lib/tracing/langfuse-status";
import { EXPENSE_CATEGORY_OPTIONS, expenseCategoryLabel } from "@/domain/portfolio/categories";

export const dynamic = "force-dynamic";

type TabKey = "overview" | "transactions" | "reports" | "imports" | "strategy" | "memory" | "chat" | "settings";

type SearchParams = Record<string, string | string[] | undefined>;

const tabs: Array<{ key: TabKey; label: string; icon: typeof WalletCards }> = [
  { key: "overview", label: "Overview", icon: WalletCards },
  { key: "transactions", label: "Transactions", icon: ReceiptText },
  { key: "reports", label: "Reports", icon: FileText },
  { key: "imports", label: "Imports", icon: Import },
  { key: "strategy", label: "Strategy", icon: PieChart },
  { key: "memory", label: "Memory", icon: Brain },
  { key: "chat", label: "Chat", icon: MessageSquare },
  { key: "settings", label: "Settings", icon: Settings }
];

function param(params: SearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function activeTab(params: SearchParams): TabKey {
  const requested = param(params, "tab");
  return tabs.some((tab) => tab.key === requested) ? (requested as TabKey) : "overview";
}

function formatMoney(value: number | { toString(): string } | null | undefined, currency = "PLN") {
  const number = Number(value ?? 0);
  return `${number.toLocaleString("pl-PL", { maximumFractionDigits: 0 })} ${currency}`;
}

function formatDate(value: Date | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium" }).format(value);
}

function formatDateTime(value: Date | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(value);
}

function dateFromParam(value: string, endOfDay = false) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function numberFromParam(value: string) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildTransactionWhere(params: SearchParams): Prisma.BankTransactionWhereInput {
  const where: Prisma.BankTransactionWhereInput = {};
  const dateFrom = dateFromParam(param(params, "dateFrom"));
  const dateTo = dateFromParam(param(params, "dateTo"), true);
  const category = param(params, "category");
  const direction = param(params, "direction");
  const merchant = param(params, "merchant");
  const amountMin = numberFromParam(param(params, "amountMin"));
  const amountMax = numberFromParam(param(params, "amountMax"));

  if (dateFrom || dateTo) {
    where.operationDate = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {})
    };
  }

  if (category) {
    where.category = category;
  }

  if (direction === "INFLOW" || direction === "OUTFLOW") {
    where.direction = direction;
  }

  if (merchant) {
    where.OR = [
      { merchant: { contains: merchant, mode: "insensitive" } },
      { description: { contains: merchant, mode: "insensitive" } }
    ];
  }

  if (amountMin !== null || amountMax !== null) {
    where.amount = {
      ...(amountMin !== null ? { gte: amountMin } : {}),
      ...(amountMax !== null ? { lte: amountMax } : {})
    };
  }

  return where;
}

function parsedPreview(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => item as Record<string, unknown>)
    .filter((item) => typeof item.description === "string" && typeof item.amount === "number")
    .slice(0, 8);
}

function reportSources(value: Prisma.JsonValue | null | undefined) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function gmailHealthLabel(health: { enabled: boolean; available: boolean }) {
  if (!health.enabled) {
    return "disabled";
  }

  return health.available ? "available" : "unavailable";
}

function shortId(value: string) {
  return value.slice(-8);
}

async function loadDashboardData(params: SearchParams) {
  const transactionWhere = buildTransactionWhere(params);

  try {
    const [
      positions,
      latestSnapshot,
      latestReport,
      reports,
      runs,
      observations,
      reflections,
      strategySettings,
      financialProfile,
      importBatches,
      transactions,
      suggestions,
      traceSpans,
      runCount,
      observationCount,
      localLlmHealth,
      gmailHealth,
      langfuseStatus,
      schedulerState
    ] = await Promise.all([
      prisma.position.findMany({
        include: { account: true, asset: true },
        orderBy: { marketValueBase: "desc" }
      }),
      prisma.portfolioSnapshot.findFirst({ orderBy: { createdAt: "desc" } }),
      prisma.report.findFirst({ orderBy: { createdAt: "desc" }, include: { run: true } }),
      prisma.report.findMany({ orderBy: { createdAt: "desc" }, take: 16, include: { run: true } }),
      prisma.agentRun.findMany({ orderBy: { startedAt: "desc" }, take: 8, include: { events: { orderBy: { createdAt: "asc" } } } }),
      prisma.observation.findMany({ orderBy: { createdAt: "desc" }, take: 24 }),
      prisma.reflection.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
      prisma.strategySettings.findUnique({ where: { resourceId: defaultStrategy.resourceId } }),
      prisma.userFinancialProfile.findUnique({ where: { resourceId: defaultStrategy.resourceId } }),
      prisma.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 24, include: { transactions: true } }),
      prisma.bankTransaction.findMany({ where: transactionWhere, orderBy: { operationDate: "desc" }, take: 200, include: { importBatch: true } }),
      prisma.strategySuggestion.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
      prisma.traceSpan.findMany({ orderBy: { startedAt: "desc" }, take: 16 }),
      prisma.agentRun.count(),
      prisma.observation.count(),
      checkLocalLlmHealth(),
      checkGmailMcpHealth(),
      checkLocalLangfuseStatus(),
      ensureSchedulerState(prisma)
    ]);

    const chatThread = await getOrCreateGlobalChatThread(prisma);
    const chatMessages = await prisma.chatMessage.findMany({
      where: { threadId: chatThread.id },
      orderBy: { createdAt: "asc" },
      take: 80
    });

    const totalValue = positions.reduce((sum, position) => sum + Number(position.marketValueBase), 0);
    const allocationByClass = Array.isArray(latestSnapshot?.allocations)
      ? []
      : ((latestSnapshot?.allocations as { byClass?: Array<{ key: string; label: string; value: number; percent: number }> } | null)?.byClass ?? []);

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthTransactions = await prisma.bankTransaction.findMany({
      where: { operationDate: { gte: currentMonthStart } },
      orderBy: { operationDate: "desc" },
      take: 500
    });
    const monthlyOutflow = monthTransactions
      .filter((transaction) => transaction.direction === "OUTFLOW")
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
    const monthlyInflow = monthTransactions
      .filter((transaction) => transaction.direction === "INFLOW")
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
    const categoryTotals = new Map<string, number>();
    for (const transaction of monthTransactions) {
      if (transaction.direction === "OUTFLOW") {
        categoryTotals.set(transaction.category, (categoryTotals.get(transaction.category) ?? 0) + Number(transaction.amount));
      }
    }
    const topCategories = Array.from(categoryTotals.entries())
      .map(([category, value]) => ({ category, value, percent: monthlyOutflow > 0 ? Math.round((value / monthlyOutflow) * 1000) / 10 : 0 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    const filteredInflow = transactions.filter((transaction) => transaction.direction === "INFLOW").reduce((sum, item) => sum + Number(item.amount), 0);
    const filteredOutflow = transactions.filter((transaction) => transaction.direction === "OUTFLOW").reduce((sum, item) => sum + Number(item.amount), 0);
    const configuredLocalLlmModel = getLocalLlmConfig().model;
    const localLlmModelPresets = LOCAL_LLM_MODEL_PRESETS.some((preset) => preset.model === configuredLocalLlmModel)
      ? LOCAL_LLM_MODEL_PRESETS
      : [
          ...LOCAL_LLM_MODEL_PRESETS,
          {
            key: "configured",
            label: "Configured",
            model: configuredLocalLlmModel,
            target: "Model configured through OLLAMA_MODEL."
          }
        ];

    startInAppScheduler();

    return {
      ready: true as const,
      positions,
      latestSnapshot,
      latestReport,
      reports,
      runs,
      observations,
      reflections,
      strategy: strategyFromSettings(strategySettings, financialProfile),
      importBatches,
      transactions,
      suggestions,
      traceSpans,
      runCount,
      observationCount,
      totalValue,
      allocationByClass,
      monthlyOutflow,
      monthlyInflow,
      topCategories,
      filteredInflow,
      filteredOutflow,
      localLlmHealth,
      gmailHealth,
      langfuseStatus,
      schedulerState,
      chatMessages,
      localLlmModelPresets,
      configuredLocalLlmModel
    };
  } catch (error) {
    return {
      ready: false as const,
      error: error instanceof Error ? error.message : "Unknown database error"
    };
  }
}

function SetupPanel({ error }: { error: string }) {
  return (
    <main className="shell">
      <section className="setup-panel">
        <Database aria-hidden="true" />
        <div>
          <p className="eyebrow">Setup required</p>
          <h1>Portfolio Copilot</h1>
          <p>Aplikacja jest gotowa kodowo, ale baza nie odpowiada albo migracje nie zostały uruchomione.</p>
          <pre>{error}</pre>
          <div className="command-list">
            <code>cp .env.example .env</code>
            <code>docker compose up -d</code>
            <code>npm run db:migrate</code>
            <code>npm run db:seed</code>
          </div>
        </div>
      </section>
    </main>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return <span className={ok ? "status-pill ok" : "status-pill warn"}>{label}</span>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof WalletCards; label: string; value: string | number }) {
  return (
    <div className="metric">
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default async function Home({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = (await searchParams) ?? {};
  const selectedTab = activeTab(params);
  const data = await loadDashboardData(params);

  if (!data.ready) {
    return <SetupPanel error={data.error} />;
  }

  const latestRisks = Array.isArray(data.latestReport?.riskFlags)
    ? (data.latestReport.riskFlags as Array<{ level: string; topic: string; message: string }>)
    : [];
  const latestImportedBatchId = data.importBatches.find((batch) => batch.status === "IMPORTED")?.id ?? null;
  const gmailState = gmailHealthLabel(data.gmailHealth);

  return (
    <main className="shell app-shell">
      <header className="topbar app-topbar">
        <div className="brand-block">
          <p className="eyebrow">Local read-only cockpit</p>
          <h1>Portfolio Copilot</h1>
          <div className="status-tape" aria-label="Local service status">
            <StatusPill ok label="PLN" />
            <StatusPill ok label="Read-only" />
            <StatusPill ok={data.gmailHealth.available} label={`Gmail ${gmailState}`} />
            <StatusPill ok={data.localLlmHealth.available} label="Ollama" />
            <StatusPill ok={data.langfuseStatus.available} label="Langfuse" />
          </div>
        </div>
        <RunAnalysisControl
          modelPresets={data.localLlmModelPresets}
          defaultModel={data.configuredLocalLlmModel}
          localLlmHealth={data.localLlmHealth}
        />
      </header>

      <nav className="tab-rail" aria-label="Portfolio sections">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <a className={selectedTab === tab.key ? "active" : undefined} href={`/?tab=${tab.key}`} key={tab.key}>
              <Icon size={17} aria-hidden="true" />
              <span>{tab.label}</span>
            </a>
          );
        })}
      </nav>

      {selectedTab === "overview" ? (
        <>
          <section className="metrics-grid" aria-label="Portfolio summary">
            <Metric icon={WalletCards} label="Total portfolio" value={formatMoney(data.totalValue)} />
            <Metric icon={Banknote} label="Month outflow" value={formatMoney(data.monthlyOutflow)} />
            <Metric icon={ShieldCheck} label="Read-only accounts" value={new Set(data.positions.map((position) => position.accountId)).size} />
            <Metric icon={AlertTriangle} label="Active risks" value={latestRisks.filter((risk) => risk.level !== "info").length} />
          </section>

          <section className="content-grid overview-grid">
            <div className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Monthly spending</h2>
                  <span>{formatMoney(data.monthlyInflow)} inflow · {formatMoney(data.monthlyOutflow)} outflow</span>
                </div>
                <ReceiptText aria-hidden="true" />
              </div>
              <div className="allocation-list category-bars">
                {data.topCategories.length > 0 ? (
                  data.topCategories.map((category) => (
                    <div className="allocation-item" key={category.category}>
                      <div>
                        <strong>{expenseCategoryLabel(category.category)}</strong>
                        <span>{formatMoney(category.value)}</span>
                      </div>
                      <div className="bar" aria-hidden="true">
                        <span style={{ width: `${Math.min(category.percent, 100)}%` }} />
                      </div>
                      <strong>{category.percent}%</strong>
                    </div>
                  ))
                ) : (
                  <p className="empty-state">No imported spending for the current month.</p>
                )}
              </div>
            </div>

            <div className="panel report-panel">
              <div className="panel-heading">
                <div>
                  <h2>Latest report</h2>
                  <span>{data.latestReport ? formatDateTime(data.latestReport.createdAt) : "not generated"}</span>
                </div>
                <FileText aria-hidden="true" />
              </div>
              {data.latestReport ? (
                <>
                  <h3>{data.latestReport.title}</h3>
                  <p className="meta-line">
                    {data.latestReport.reportType.toLowerCase()} · {data.latestReport.run.status} · critic {data.latestReport.criticVerdict} · {data.latestReport.reporterSource}
                  </p>
                  <p>{data.latestReport.summary}</p>
                </>
              ) : (
                <p className="empty-state">No report yet.</p>
              )}
            </div>
          </section>

          <section className="content-grid lower">
            <div className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Allocation</h2>
                  <span>{data.latestSnapshot ? "latest run" : "seed only"}</span>
                </div>
                <PieChart aria-hidden="true" />
              </div>
              <div className="allocation-list">
                {data.allocationByClass.length > 0 ? (
                  data.allocationByClass.map((item) => (
                    <div className="allocation-item" key={item.key}>
                      <div>
                        <strong>{item.label}</strong>
                        <span>{formatMoney(item.value)}</span>
                      </div>
                      <div className="bar" aria-hidden="true">
                        <span style={{ width: `${Math.min(item.percent, 100)}%` }} />
                      </div>
                      <strong>{item.percent}%</strong>
                    </div>
                  ))
                ) : (
                  <p className="empty-state">Run analysis to write the first allocation snapshot.</p>
                )}
              </div>
            </div>

            <div className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Risk tape</h2>
                  <span>{latestRisks.length} latest flags</span>
                </div>
                <AlertTriangle aria-hidden="true" />
              </div>
              <div className="memory-list compact-memory">
                {latestRisks.slice(0, 6).map((risk, index) => (
                  <article key={`${risk.topic}-${index}`}>
                    <span>{risk.level}</span>
                    <strong>{risk.topic}</strong>
                    <p>{risk.message}</p>
                  </article>
                ))}
                {latestRisks.length === 0 ? <p className="empty-state">No report risks yet.</p> : null}
              </div>
            </div>
          </section>
        </>
      ) : null}

      {selectedTab === "transactions" ? (
        <section className="tab-panel">
          <div className="panel">
            <div className="panel-heading">
              <div>
                <h2>Transactions</h2>
                <span>{data.transactions.length} rows · {formatMoney(data.filteredInflow)} inflow · {formatMoney(data.filteredOutflow)} outflow</span>
              </div>
              <Search aria-hidden="true" />
            </div>
            <form className="filter-grid" action="/" method="get">
              <input type="hidden" name="tab" value="transactions" />
              <label><span>From</span><input name="dateFrom" type="date" defaultValue={param(params, "dateFrom")} /></label>
              <label><span>To</span><input name="dateTo" type="date" defaultValue={param(params, "dateTo")} /></label>
              <label><span>Category</span><select name="category" defaultValue={param(params, "category")}><option value="">Any</option>{EXPENSE_CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label><span>Direction</span><select name="direction" defaultValue={param(params, "direction")}><option value="">Any</option><option value="INFLOW">Inflow</option><option value="OUTFLOW">Outflow</option></select></label>
              <label><span>Merchant</span><input name="merchant" defaultValue={param(params, "merchant")} /></label>
              <label><span>Min</span><input name="amountMin" type="number" step="1" defaultValue={param(params, "amountMin")} /></label>
              <label><span>Max</span><input name="amountMax" type="number" step="1" defaultValue={param(params, "amountMax")} /></label>
              <button className="secondary-button" type="submit"><Search size={18} aria-hidden="true" /> Filter</button>
            </form>
            <div className="table transaction-table">
              {data.transactions.map((transaction) => (
                <div
                  className={transaction.importBatchId === latestImportedBatchId ? "table-row transaction-row fresh-transaction" : "table-row transaction-row"}
                  key={transaction.id}
                >
                  <div>
                    <strong>{transaction.merchant ?? transaction.description}</strong>
                    <span>{transaction.description}</span>
                    <span>mBank email · batch {shortId(transaction.importBatchId)}</span>
                  </div>
                  <span>{formatDate(transaction.operationDate)}</span>
                  <TransactionCategoryControl transactionId={transaction.id} category={transaction.category} />
                  <span>{transaction.direction}</span>
                  <strong>{formatMoney(transaction.amount, transaction.currency)}</strong>
                </div>
              ))}
              {data.transactions.length === 0 ? <p className="empty-state table-empty">No transactions match the current filters.</p> : null}
            </div>
          </div>
        </section>
      ) : null}

      {selectedTab === "reports" ? (
        <section className="tab-panel report-history">
          {data.reports.map((report) => {
            const sources = reportSources(report.sources);
            const hasRealTransactions = sources.includes("bank-transactions:mbank-email");

            return (
              <article className="panel report-panel" key={report.id}>
                <div className="panel-heading">
                  <div>
                    <h2>{report.title}</h2>
                    <span>{formatDateTime(report.createdAt)} · {report.reportType.toLowerCase()}</span>
                  </div>
                  <FileText aria-hidden="true" />
                </div>
                <div className="report-source-grid" aria-label="Report source diagnostics">
                  <div><span>Reporter</span><strong>{report.reporterSource}</strong></div>
                  <div><span>Model</span><strong>{report.reporterModel ?? "deterministic"}</strong></div>
                  <div><span>Real transactions</span><strong>{hasRealTransactions ? "included" : "not in context"}</strong></div>
                </div>
                <p className="meta-line">Run {shortId(report.run.id)} · {report.run.status} · critic {report.criticVerdict}</p>
                <div className="source-chip-row">
                  {sources.map((source) => <span className="source-chip" key={`${report.id}-${source}`}>{source}</span>)}
                  {sources.length === 0 ? <span className="source-chip muted-chip">no sources saved</span> : null}
                </div>
                <p>{report.summary}</p>
                <pre>{report.markdown}</pre>
              </article>
            );
          })}
          {data.reports.length === 0 ? <div className="panel"><p className="empty-state">No reports saved.</p></div> : null}
        </section>
      ) : null}

      {selectedTab === "imports" ? (
        <section className="content-grid imports-grid">
          <div className="panel">
            <div className="panel-heading">
              <div>
                <h2>Gmail mBank imports</h2>
                <span>{data.gmailHealth.reason}</span>
              </div>
              {data.gmailHealth.available ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}
            </div>
            <div className={`service-banner ${data.gmailHealth.available ? "service-ok" : data.gmailHealth.enabled ? "service-warn" : "service-muted"}`}>
              <span>Gmail is {gmailState}</span>
              <strong>{data.gmailHealth.baseUrl}</strong>
              <p>Manual Sync now reads at most the configured single-message window. OAuth and Gmail access stay user-run outside the app.</p>
            </div>
            <SyncMbankControl />
            <div className="import-list">
              {data.importBatches.map((batch) => (
                <article className="import-card" key={batch.id}>
                  <div>
                    <strong>{batch.subject ?? batch.gmailMessageId}</strong>
                    <span>{batch.status} · {formatDate(batch.operationDate)} · {batch.transactionCount} tx</span>
                  </div>
                  {batch.errorMessage ? <p className="error-copy">{batch.errorMessage}</p> : null}
                  <ImportBatchActions batchId={batch.id} status={batch.status} />
                  {batch.status === "PENDING_REVIEW" ? (
                    <div className="preview-list">
                      {parsedPreview(batch.parsedTransactions).map((item, index) => (
                        <div className="preview-row" key={`${batch.id}-${index}`}>
                          <ImportPreviewCategoryControl batchId={batch.id} transactionIndex={index} category={String(item.category)} />
                          <strong>{String(item.description)}</strong>
                          <span>{formatMoney(Number(item.amount), String(item.currency ?? "PLN"))}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
              {data.importBatches.length === 0 ? <p className="empty-state">No import batches yet.</p> : null}
            </div>
          </div>

          <div className="panel">
            <div className="panel-heading">
              <div>
                <h2>Scheduler</h2>
                <span>{data.schedulerState.timezone} · {data.schedulerState.timeOfDay}</span>
              </div>
              <CalendarClock aria-hidden="true" />
            </div>
            <div className="strategy-summary">
              <div><span>Last sync</span><strong>{formatDateTime(data.schedulerState.lastRunAt)}</strong></div>
              <div><span>Next sync</span><strong>{formatDateTime(data.schedulerState.nextRunAt)}</strong></div>
              <div><span>Status</span><strong>{data.schedulerState.running ? "running" : data.schedulerState.lastStatus ?? "idle"}</strong></div>
              <div><span>Last error</span><strong>{data.schedulerState.lastError ?? "none"}</strong></div>
            </div>
            <p className="helper-copy">This scheduler runs only while the Next.js app and Gmail API access are available. Manual Sync now remains the real-import gate.</p>
            <SchedulerNowControl />
          </div>
        </section>
      ) : null}

      {selectedTab === "strategy" ? (
        <section className="content-grid strategy-grid">
          <StrategySettingsForm strategy={data.strategy} />
          <div className="panel">
            <div className="panel-heading">
              <div>
                <h2>Strategy suggestions</h2>
                <span>{data.suggestions.length} latest</span>
              </div>
              <PieChart aria-hidden="true" />
            </div>
            <div className="memory-list">
              {data.suggestions.map((suggestion) => (
                <article key={suggestion.id}>
                  <span>{suggestion.status}</span>
                  <strong>{suggestion.title}</strong>
                  <p>{suggestion.rationale}</p>
                </article>
              ))}
              {data.suggestions.length === 0 ? <p className="empty-state">No strategy suggestions yet.</p> : null}
            </div>
          </div>
        </section>
      ) : null}

      {selectedTab === "memory" ? (
        <section className="content-grid lower">
          <div className="panel">
            <div className="panel-heading">
              <div><h2>Observations</h2><span>{data.observations.length} latest</span></div>
              <Brain aria-hidden="true" />
            </div>
            <div className="memory-list">
              {data.observations.map((observation) => (
                <article key={observation.id}>
                  <span>{observation.priority}</span>
                  <strong>{observation.topic}</strong>
                  <p>{observation.content}</p>
                </article>
              ))}
              {data.observations.length === 0 ? <p className="empty-state">No observations yet.</p> : null}
            </div>
          </div>
          <div className="panel">
            <div className="panel-heading">
              <div><h2>Reflections</h2><span>{data.reflections.length} latest</span></div>
              <History aria-hidden="true" />
            </div>
            <div className="memory-list">
              {data.reflections.map((reflection) => (
                <article key={reflection.id}>
                  <span>{formatDate(reflection.createdAt)}</span>
                  <strong>Reflection</strong>
                  <p>{reflection.summary}</p>
                </article>
              ))}
              {data.reflections.length === 0 ? <p className="empty-state">No reflections yet.</p> : null}
            </div>
          </div>
        </section>
      ) : null}

      {selectedTab === "chat" ? (
        <section className="tab-panel">
          <div className="panel">
            <div className="panel-heading">
              <div><h2>Global local chat</h2><span>{data.chatMessages.length} messages</span></div>
              <Bot aria-hidden="true" />
            </div>
            <ChatPanel messages={data.chatMessages} modelPresets={data.localLlmModelPresets} defaultModel={data.configuredLocalLlmModel} />
          </div>
        </section>
      ) : null}

      {selectedTab === "settings" ? (
        <section className="content-grid settings-grid">
          <div className="panel">
            <div className="panel-heading">
              <div><h2>Local services</h2><span>No external LLM providers</span></div>
              <Settings aria-hidden="true" />
            </div>
            <div className="strategy-summary service-grid">
              <div><span>Ollama</span><strong>{data.localLlmHealth.available ? "available" : "unavailable"}</strong></div>
              <div><span>Model</span><strong>{data.localLlmHealth.model}</strong></div>
              <div><span>Gmail</span><strong>{data.gmailHealth.enabled ? data.gmailHealth.reason : "disabled"}</strong></div>
              <div><span>Langfuse</span><strong>{data.langfuseStatus.reason}</strong></div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-heading">
              <div><h2>Retention</h2><span>Reports, runs, events and trace spans are limited to about 3 months</span></div>
              <Clock3 aria-hidden="true" />
            </div>
            <RetentionCleanupControl />
          </div>
          <div className="panel wide-panel">
            <div className="panel-heading">
              <div><h2>Trace spans</h2><span>{data.traceSpans.length} latest</span></div>
              <History aria-hidden="true" />
            </div>
            <div className="table trace-table">
              {data.traceSpans.map((span) => (
                <div className="table-row trace-row" key={span.id}>
                  <div><strong>{span.name}</strong><span>{span.traceId.slice(-10)}</span></div>
                  <span>{span.status}</span>
                  <span>{span.level}</span>
                  <strong>{formatDateTime(span.startedAt)}</strong>
                </div>
              ))}
              {data.traceSpans.length === 0 ? <p className="empty-state table-empty">No trace spans yet.</p> : null}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
