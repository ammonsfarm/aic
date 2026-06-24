import { AdminConsole } from "@/components/admin-console";
import { RoutePanel } from "@/components/route-panel";
import { getSupportedAgentModels } from "@/lib/agent-models";
import { getAgentSettingsView } from "@/lib/agent-settings";
import { listAppUsers, requireAdministrator } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdministrator("/overview");
  const settings = await getAgentSettingsView();
  const [users, modelCatalog] = await Promise.all([listAppUsers(), getSupportedAgentModels(settings.provider)]);

  return (
    <RoutePanel
      eyebrow="Admin"
      title="Security and agent settings"
      aside={
        <div className="research-aside">
          <p>
            Admin changes are enforced in the API routes. Users get the User role by default, and Admin can be assigned by email.
          </p>
          <div className="research-aside__list" aria-label="Admin scope">
            <span>Agent provider, model, and System API_KEY</span>
            <span>User and Admin role assignment</span>
            <span>Per-user research and episode history</span>
          </div>
        </div>
      }
    >
      <AdminConsole initialSettings={settings} initialUsers={users} initialModelCatalog={modelCatalog} />
    </RoutePanel>
  );
}
