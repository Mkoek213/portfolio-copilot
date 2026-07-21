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
import { ChatPanel } from "./components/chat-panel";
import { RunAnalysisControl } from "./components/run-analysis-control";
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
    <main className="setup-shell">
      <section className="panel setup-panel">
        <Database aria-hidden="true" />
        <div>
          <p className="eyebrow">Setup required</p>
          <h1>Portfolio Copilot</h1>
          <p>The app code is ready, but the database is not responding or migrations have not been run.</p>
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

function ServiceDot({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="service-row" title={detail}>
      <i className={ok ? "service-dot ok" : "service-dot warn"} aria-hidden="true" />
      <span>{label}</span>
      <em>{ok ? "on" : detail}</em>
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

  const gmailState = gmailHealthLabel(data.gmailHealth);
  const currentTab = tabs.find((tab) => tab.key === selectedTab) ?? tabs[0];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Wallet size={18} />
          </span>
          <div>
            <strong>Portfolio Copilot</strong>
            <span>Local financial cockpit</span>
          </div>
        </div>

        <nav className="side-nav" aria-label="Sections">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <Link className={selectedTab === tab.key ? "active" : undefined} href={`/?tab=${tab.key}`} key={tab.key} aria-current={selectedTab === tab.key ? "page" : undefined}>
                <Icon size={17} aria-hidden="true" />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="service-row readonly-row">
            <ShieldCheck size={14} aria-hidden="true" />
            <span>Read-only · PLN</span>
          </div>
          <ServiceDot ok={data.gmailHealth.available} label="Gmail" detail={gmailState} />
          <ServiceDot ok={data.localLlmHealth.available} label="Ollama" detail={data.localLlmHealth.available ? "on" : "off"} />
          <ServiceDot ok={data.langfuseStatus.available} label="Langfuse" detail={data.langfuseStatus.available ? "on" : "off"} />
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{currentTab.label}</h1>
            <p>{currentTab.description}</p>
          </div>
          <RunAnalysisControl
            modelPresets={data.localLlmModelPresets}
            defaultModel={data.configuredLocalLlmModel}
            localLlmHealth={data.localLlmHealth}
          />
        </header>

        <main className="content" key={selectedTab}>
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
        </main>
      </div>
    </div>
  );
}
