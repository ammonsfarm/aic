import { AdminConsole } from "@/components/admin-console";
import { RoutePanel } from "@/components/route-panel";
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
  const [users, modelCatalog] = await Promise.all([listAppUsers(), getSupportedAgentModels(settings.provider)]);

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
      <AdminConsole initialSettings={settings} initialUsers={users} initialModelCatalog={modelCatalog} />
    </RoutePanel>
  );
}
