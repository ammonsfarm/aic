import Link from "next/link";

import { AdminConsole } from "@/components/admin-console";
import { DataFreshnessNotice } from "@/components/data-freshness";
import { RoutePanel } from "@/components/route-panel";
import { getOperationalDashboard } from "@/lib/admin-operations";
import { getSupportedAgentModels } from "@/lib/agent-models";
import { getAgentSettingsView, type AgentSettingsView } from "@/lib/agent-settings";
import { listAppUsers, requireAdministrator } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const localFallbackSettings: AgentSettingsView = {
  provider: "silo",
  model: "",
  effectiveModel: "gpt-5.4-mini",
  reasoningEffort: "",
  retrieval: {
    archiveTopK: 10,
    archiveMaxSources: 16,
    researchSourceBudget: 24,
    researchCandidateEpisodes: 8,
    researchSummaryEpisodes: 6,
    researchDetailExcerpts: 30,
    researchMaxSources: 40,
    researchInterviewInventoryLimit: 60,
    researchInterviewMaxSources: 72,
  },
  hasSystemApiKey: false,
  systemApiKeyUpdatedAt: null,
  updatedBy: "local fallback",
  updatedAt: null,
};

async function getAdminSettings() {
  try {
    return await getAgentSettingsView();
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Local agent settings lookup failed; showing fallback settings.", error);
      return localFallbackSettings;
    }

    throw error;
  }
}

export default async function AdminPage() {
  await requireAdministrator("/overview");
  const settings = await getAdminSettings();
  const [users, modelCatalog, operations] = await Promise.all([
    listAppUsers(),
    getSupportedAgentModels(settings.provider),
    getOperationalDashboard({ limit: 10 }),
  ]);

  return (
    <RoutePanel
      eyebrow="Admin"
      title="Security and agent settings"
      aside={
        <div className="research-aside">
          <p>
            Admin changes are enforced in the API routes. Users get the User role by default. Assign Content Manager for public site editing, Research User for protected corpus tools, and Admin for system settings.
          </p>
          <div className="research-aside__list" aria-label="Admin scope">
            <span>Agent provider, model, and System API_KEY</span>
            <span>RAG retrieval budgets and cited source caps</span>
            <span>User, Content Manager, Research User, Read Only, and Admin role assignment</span>
            <span>Per-user research and episode history</span>
          </div>
        </div>
      }
    >
      <section className="admin-section" id="system-health">
        <div className="admin-section__header">
          <div>
            <p className="eyebrow">System health</p>
            <h2>Authoritative operational state</h2>
          </div>
          <Link className="button button--ghost" href="/pipeline">Open pipeline controls</Link>
        </div>
        <div className="split-board split-board--wide">
          <DataFreshnessNotice label="Daily ingest" freshness={operations.freshness.ingest} />
          <DataFreshnessNotice label="Podtrac" freshness={operations.freshness.podtrac} />
          <div className={operations.podtracAuth.state === "auth-error" ? "status-item status-item--warn" : "status-item"} role={operations.podtracAuth.state === "auth-error" ? "alert" : "status"}>
            <strong>Podtrac authentication: {operations.podtracAuth.state}</strong>
            <span>{operations.podtracAuth.message}</span>
          </div>
        </div>
        <div className="status-list status-list--compact">
          <span><strong>Queued retries</strong>{operations.retries.filter((item) => item.status === "queued").length}</span>
          <span><strong>Running retries</strong>{operations.retries.filter((item) => item.status === "running").length}</span>
          <span><strong>Failed transcript edits</strong>{operations.transcript.counts.failed ?? 0}</span>
          <span><strong>Pending transcript edits</strong>{operations.transcript.counts.pending ?? 0}</span>
        </div>
      </section>
      <AdminConsole initialSettings={settings} initialUsers={users} initialModelCatalog={modelCatalog} />
    </RoutePanel>
  );
}
