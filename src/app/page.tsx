import Link from "next/link";
import {
  Bot,
  Brain,
  Database,
  FileText,
  Import,
  LayoutDashboard,
  MessageSquare,
  PieChart,
  ReceiptText,
  Settings,
  ShieldCheck,
  Wallet
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatPanel } from "./components/chat-panel";
import { RunAnalysisControl } from "./components/run-analysis-control";
import { ThemeToggle } from "./components/theme-toggle";
import { TabTransition } from "./components/tab-transition";
import { OverviewTab } from "./components/tabs/overview-tab";
import { TransactionsTab } from "./components/tabs/transactions-tab";
import { ReportsTab } from "./components/tabs/reports-tab";
import { ImportsTab } from "./components/tabs/imports-tab";
import { StrategyTab } from "./components/tabs/strategy-tab";
import { MemoryTab } from "./components/tabs/memory-tab";
import { SettingsTab } from "./components/tabs/settings-tab";
import { PanelHeading } from "./components/ui";
import { loadDashboardData, param, type SearchParams } from "./dashboard-data";

export const dynamic = "force-dynamic";

type TabKey = "overview" | "transactions" | "reports" | "imports" | "strategy" | "memory" | "chat" | "settings";

const tabs: Array<{ key: TabKey; label: string; description: string; icon: typeof Wallet }> = [
  { key: "overview", label: "Overview", description: "Portfolio, cashflow and risks at a glance", icon: LayoutDashboard },
  { key: "transactions", label: "Transactions", description: "Imported mBank transactions with filters", icon: ReceiptText },
  { key: "reports", label: "Reports", description: "Locally generated AI analysis reports", icon: FileText },
  { key: "imports", label: "Imports", description: "Gmail mBank import batches and scheduler", icon: Import },
  { key: "strategy", label: "Strategy", description: "Financial profile, guardrails and suggestions", icon: PieChart },
  { key: "memory", label: "Memory", description: "Agent observations and reflections", icon: Brain },
  { key: "chat", label: "Chat", description: "Ask the local assistant about your finances", icon: MessageSquare },
  { key: "settings", label: "Settings", description: "Local services, retention and tracing", icon: Settings }
];

function activeTab(params: SearchParams): TabKey {
  const requested = param(params, "tab");
  return tabs.some((tab) => tab.key === requested) ? (requested as TabKey) : "overview";
}

function gmailHealthLabel(health: { enabled: boolean; available: boolean }) {
  if (!health.enabled) {
    return "disabled";
  }

  return health.available ? "available" : "unavailable";
}

function SetupPanel({ error }: { error: string }) {
  return (
    <main className="relative z-10 grid min-h-screen place-items-center p-5">
      <section className="grid max-w-[720px] grid-cols-[48px_minmax(0,1fr)] items-start gap-[18px] rounded-[10px] border border-border bg-card p-7 text-foreground shadow-card">
        <Database aria-hidden="true" className="size-12 text-brand" />
        <div>
          <p className="mb-1.5 text-[0.72rem] font-bold uppercase tracking-[0.06em] text-brand">Setup required</p>
          <h1 className="mb-2 text-[1.6rem] tracking-[-0.01em]">Portfolio Copilot</h1>
          <p className="text-foreground/80">The app code is ready, but the database is not responding or migrations have not been run.</p>
          <pre className="mt-3 max-h-[300px] overflow-auto whitespace-pre-wrap rounded-md bg-[#22241f] p-3 font-mono text-[0.8rem] leading-normal text-[#eef5ee]">{error}</pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <code className="rounded-md border border-border bg-secondary px-2.5 py-[7px] font-mono text-[0.78rem]">cp .env.example .env</code>
            <code className="rounded-md border border-border bg-secondary px-2.5 py-[7px] font-mono text-[0.78rem]">docker compose up -d</code>
            <code className="rounded-md border border-border bg-secondary px-2.5 py-[7px] font-mono text-[0.78rem]">npm run db:migrate</code>
            <code className="rounded-md border border-border bg-secondary px-2.5 py-[7px] font-mono text-[0.78rem]">npm run db:seed</code>
          </div>
        </div>
      </section>
    </main>
  );
}

function ServiceDot({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-2 text-[0.76rem] text-muted-foreground" title={detail}>
      <span className="relative flex size-2 flex-shrink-0 items-center justify-center">
        {ok ? <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-60" /> : null}
        <span className={cn("relative size-2 rounded-full", ok ? "bg-good" : "bg-muted-foreground/40")} />
      </span>
      <span>{label}</span>
      <em className="ml-auto text-[0.72rem] not-italic text-muted-foreground">{ok ? "on" : detail}</em>
    </div>
  );
}

const navBase =
  "flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium no-underline transition-[color,background-color,transform] duration-150 ease-out [&_svg]:transition-transform [&_svg]:duration-150 max-[920px]:whitespace-nowrap";
const navInactive = "text-muted-foreground hover:translate-x-0.5 hover:bg-secondary hover:text-foreground [&:hover_svg]:scale-110";
const navActive = "bg-brand-soft font-semibold text-brand-strong [&_svg]:text-brand";

export default async function Home({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = (await searchParams) ?? {};
  const selectedTab = activeTab(params);
  const data = await loadDashboardData(params);

  if (!data.ready) {
    return <SetupPanel error={data.error} />;
  }

  const gmailState = gmailHealthLabel(data.gmailHealth);
  const currentTab = tabs.find((tab) => tab.key === selectedTab) ?? tabs[0];

  return (
    <div className="relative z-10 flex min-h-screen max-[920px]:flex-col">
      <aside className="sticky top-0 flex h-screen w-[236px] flex-shrink-0 flex-col border-r border-border bg-card px-3.5 py-[18px] text-foreground max-[920px]:static max-[920px]:h-auto max-[920px]:w-full max-[920px]:flex-row max-[920px]:items-center max-[920px]:gap-2.5 max-[920px]:border-b max-[920px]:border-r-0 max-[920px]:px-3.5 max-[920px]:py-2.5">
        <div className="flex items-center gap-2.5 px-2 pb-[18px] pt-1 max-[920px]:flex-shrink-0 max-[920px]:p-0">
          <span className="inline-flex size-[34px] flex-shrink-0 items-center justify-center rounded-[9px] bg-primary text-primary-foreground" aria-hidden="true">
            <Wallet size={18} />
          </span>
          <div>
            <strong className="block text-[0.92rem] tracking-[-0.01em]">Portfolio Copilot</strong>
            <span className="block text-[0.72rem] text-muted-foreground max-[920px]:hidden">Local financial cockpit</span>
          </div>
        </div>

        <nav className="grid gap-0.5 max-[920px]:flex max-[920px]:overflow-x-auto" aria-label="Sections">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = selectedTab === tab.key;
            return (
              <Link
                className={cn(navBase, isActive ? navActive : navInactive)}
                href={`/?tab=${tab.key}`}
                key={tab.key}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto grid gap-1.5 border-t border-border px-2 pb-0.5 pt-3 max-[920px]:hidden">
          <ThemeToggle />
          <div className="flex items-center gap-2 text-[0.76rem] font-semibold text-brand-strong">
            <ShieldCheck size={14} aria-hidden="true" className="text-brand" />
            <span>Read-only · PLN</span>
          </div>
          <ServiceDot ok={data.gmailHealth.available} label="Gmail" detail={gmailState} />
          <ServiceDot ok={data.localLlmHealth.available} label="Ollama" detail={data.localLlmHealth.available ? "on" : "off"} />
          <ServiceDot ok={data.langfuseStatus.available} label="Langfuse" detail={data.langfuseStatus.available ? "on" : "off"} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-start justify-between gap-5 border-b border-border bg-card px-7 py-[18px] text-foreground max-[920px]:flex-col max-[920px]:items-stretch max-[920px]:px-4 max-[920px]:py-3.5">
          <div>
            <h1 className="text-[1.25rem] font-[650] tracking-[-0.01em]">{currentTab.label}</h1>
            <p className="mt-0.5 text-[0.82rem] text-muted-foreground">{currentTab.description}</p>
          </div>
          <div className="flex items-start gap-3 max-[920px]:justify-between">
            <div className="hidden max-[920px]:flex">
              <ThemeToggle compact />
            </div>
            <RunAnalysisControl
              modelPresets={data.localLlmModelPresets}
              defaultModel={data.configuredLocalLlmModel}
              localLlmHealth={data.localLlmHealth}
            />
          </div>
        </header>

        <main className="w-full max-w-[1240px] px-7 pb-12 pt-6 max-[920px]:px-4 max-[920px]:pb-10 max-[920px]:pt-4">
          <TabTransition tabKey={selectedTab}>
            {selectedTab === "overview" ? <OverviewTab data={data} /> : null}
            {selectedTab === "transactions" ? <TransactionsTab data={data} params={params} /> : null}
            {selectedTab === "reports" ? <ReportsTab data={data} /> : null}
            {selectedTab === "imports" ? <ImportsTab data={data} gmailState={gmailState} /> : null}
            {selectedTab === "strategy" ? <StrategyTab data={data} /> : null}
            {selectedTab === "memory" ? <MemoryTab data={data} /> : null}
            {selectedTab === "chat" ? (
              <section className="panel chat-panel-shell">
                <PanelHeading
                  title="Local assistant"
                  sub={`${data.chatMessages.length} messages · answers only from local data`}
                  action={<Bot aria-hidden="true" className="panel-icon" />}
                />
                <ChatPanel messages={data.chatMessages} modelPresets={data.localLlmModelPresets} defaultModel={data.configuredLocalLlmModel} />
              </section>
            ) : null}
            {selectedTab === "settings" ? <SettingsTab data={data} /> : null}
          </TabTransition>
        </main>
      </div>
    </div>
  );
}
