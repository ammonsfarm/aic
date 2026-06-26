"use client";

import { FormEvent, useState } from "react";

type AicRole = "User" | "Admin";
type AgentProvider = "silo" | "openai";

type AgentSettings = {
  provider: AgentProvider;
  model: string;
  effectiveModel: string;
  reasoningEffort: "" | "low" | "medium" | "high";
  retrieval: RetrievalSettings;
  hasSystemApiKey: boolean;
  systemApiKeyUpdatedAt: string | null;
  updatedBy: string;
  updatedAt: string | null;
};

type RetrievalSettings = {
  archiveTopK: number;
  archiveMaxSources: number;
  researchSourceBudget: number;
  researchCandidateEpisodes: number;
  researchSummaryEpisodes: number;
  researchDetailExcerpts: number;
  researchMaxSources: number;
  researchInterviewInventoryLimit: number;
  researchInterviewMaxSources: number;
};

type RetrievalKey = keyof RetrievalSettings;

type AgentModelOption = {
  id: string;
  displayName: string;
  provider: string;
  ownedBy: string;
  availability: string;
  reasoningEffortLevels: Array<"low" | "medium" | "high">;
};

type ModelCatalog = {
  models: AgentModelOption[];
  source: string;
  error: string;
};

type AppUser = {
  clerkUserId: string;
  email: string;
  name: string;
  role: AicRole;
  lastSeenAt: string | null;
  updatedAt: string | null;
};

type AdminConsoleProps = {
  initialSettings: AgentSettings;
  initialUsers: AppUser[];
  initialModelCatalog: ModelCatalog;
};

const retrievalFields: Array<{
  key: RetrievalKey;
  label: string;
  help: string;
  min: number;
  max: number;
}> = [
  {
    key: "researchSourceBudget",
    label: "Research source budget",
    help: "First-pass structured and semantic matches per lane.",
    min: 8,
    max: 60,
  },
  {
    key: "researchCandidateEpisodes",
    label: "Candidate episodes",
    help: "Likely episodes used for summaries and detail search.",
    min: 1,
    max: 20,
  },
  {
    key: "researchSummaryEpisodes",
    label: "Summary episodes",
    help: "Episode summaries added after candidates are found.",
    min: 0,
    max: 12,
  },
  {
    key: "researchDetailExcerpts",
    label: "Detail excerpts",
    help: "Full-transcript detail snippets added for exact wording.",
    min: 0,
    max: 60,
  },
  {
    key: "researchMaxSources",
    label: "Standard cited sources",
    help: "Final cited source cap for normal research questions.",
    min: 8,
    max: 80,
  },
  {
    key: "researchInterviewInventoryLimit",
    label: "Interview inventory",
    help: "Structured interview items considered for guest questions.",
    min: 0,
    max: 120,
  },
  {
    key: "researchInterviewMaxSources",
    label: "Interview cited sources",
    help: "Final cited source cap for interview and guest questions.",
    min: 8,
    max: 120,
  },
  {
    key: "archiveTopK",
    label: "Archive matches",
    help: "Semantic matches used by archive and episode chat.",
    min: 1,
    max: 40,
  },
  {
    key: "archiveMaxSources",
    label: "Archive cited sources",
    help: "Final source cap for archive and episode chat.",
    min: 1,
    max: 40,
  },
];

function formatDate(value: string | null) {
  if (!value) {
    return "Not recorded";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function effortDefault(levels: AgentModelOption["reasoningEffortLevels"], current: AgentSettings["reasoningEffort"]) {
  if (current && levels.includes(current)) {
    return current;
  }

  if (levels.includes("medium")) {
    return "medium";
  }

  return levels[0] ?? "";
}

export function AdminConsole({ initialSettings, initialUsers, initialModelCatalog }: AdminConsoleProps) {
  const initialModel = initialSettings.model || initialSettings.effectiveModel;
  const initialModelOption = initialModelCatalog.models.find((option) => option.id === initialModel);
  const [settings, setSettings] = useState(initialSettings);
  const [provider, setProvider] = useState<AgentProvider>(initialSettings.provider);
  const [model, setModel] = useState(initialModel);
  const [reasoningEffort, setReasoningEffort] = useState<AgentSettings["reasoningEffort"]>(
    effortDefault(initialModelOption?.reasoningEffortLevels ?? [], initialSettings.reasoningEffort),
  );
  const [modelCatalog, setModelCatalog] = useState(initialModelCatalog);
  const [loadingModels, setLoadingModels] = useState(false);
  const [retrieval, setRetrieval] = useState<RetrievalSettings>(initialSettings.retrieval);
  const [systemApiKey, setSystemApiKey] = useState("");
  const [clearSystemApiKey, setClearSystemApiKey] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  const [users, setUsers] = useState(initialUsers);
  const [roleEmail, setRoleEmail] = useState("");
  const [role, setRole] = useState<AicRole>("User");
  const [roleMessage, setRoleMessage] = useState("");
  const [roleError, setRoleError] = useState("");
  const [savingRole, setSavingRole] = useState("");
  const selectedModel = modelCatalog.models.find((option) => option.id === model);
  const currentModelOption = model && !selectedModel
    ? [{ id: model, displayName: model, provider, ownedBy: "saved setting", availability: "saved", reasoningEffortLevels: [] }]
    : [];
  const modelOptions = [...currentModelOption, ...modelCatalog.models];
  const effortLevels = selectedModel?.reasoningEffortLevels ?? [];

  const loadModels = async (nextProvider: AgentProvider, nextModel = model) => {
    setLoadingModels(true);
    setSettingsError("");

    try {
      const response = await fetch(`/api/admin/settings/models?provider=${encodeURIComponent(nextProvider)}`);
      const payload = (await response.json().catch(() => ({}))) as ModelCatalog & { error?: string };
      if (!response.ok || !Array.isArray(payload.models)) {
        setSettingsError(payload.error ?? `Model list failed (${response.status})`);
        return;
      }

      const nextCatalog = {
        models: payload.models,
        source: payload.source ?? "",
        error: payload.error ?? "",
      };
      const nextSelected = nextCatalog.models.find((option) => option.id === nextModel) ?? nextCatalog.models[0];
      setModelCatalog(nextCatalog);

      if (nextSelected) {
        setModel(nextSelected.id);
        setReasoningEffort(effortDefault(nextSelected.reasoningEffortLevels, reasoningEffort));
      } else {
        setReasoningEffort("");
      }
    } catch {
      setSettingsError("Could not load supported models.");
    } finally {
      setLoadingModels(false);
    }
  };

  const onProviderChange = (nextProvider: AgentProvider) => {
    setProvider(nextProvider);
    void loadModels(nextProvider);
  };

  const onModelChange = (nextModel: string) => {
    setModel(nextModel);
    const option = modelCatalog.models.find((entry) => entry.id === nextModel);
    setReasoningEffort(effortDefault(option?.reasoningEffortLevels ?? [], reasoningEffort));
  };

  const onRetrievalChange = (key: RetrievalKey, nextValue: string) => {
    const numericValue = Number(nextValue);
    setRetrieval((current) => ({
      ...current,
      [key]: Number.isFinite(numericValue) ? Math.trunc(numericValue) : current[key],
    }));
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingSettings(true);
    setSettingsMessage("");
    setSettingsError("");

    try {
      const response = await fetch("/api/admin/settings/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model,
          reasoningEffort,
          retrieval,
          systemApiKey,
          clearSystemApiKey,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { settings?: AgentSettings; error?: string };

      if (!response.ok || !payload.settings) {
        setSettingsError(payload.error ?? `Settings update failed (${response.status})`);
        return;
      }

      setSettings(payload.settings);
      setProvider(payload.settings.provider);
      setModel(payload.settings.model || payload.settings.effectiveModel);
      setReasoningEffort(payload.settings.reasoningEffort);
      setRetrieval(payload.settings.retrieval);
      setSystemApiKey("");
      setClearSystemApiKey(false);
      setSettingsMessage("Agent settings saved.");
    } catch {
      setSettingsError("Could not reach the admin settings endpoint.");
    } finally {
      setSavingSettings(false);
    }
  };

  const saveRole = async (email: string, nextRole: AicRole) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      return;
    }

    setSavingRole(normalizedEmail);
    setRoleMessage("");
    setRoleError("");

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, role: nextRole }),
      });
      const payload = (await response.json().catch(() => ({}))) as { users?: AppUser[]; error?: string };

      if (!response.ok || !payload.users) {
        setRoleError(payload.error ?? `Role update failed (${response.status})`);
        return;
      }

      setUsers(payload.users);
      setRoleEmail("");
      setRole("User");
      setRoleMessage(`Saved ${normalizedEmail} as ${nextRole}.`);
    } catch {
      setRoleError("Could not reach the user role endpoint.");
    } finally {
      setSavingRole("");
    }
  };

  const assignNewRole = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await saveRole(roleEmail, role);
  };

  return (
    <div className="admin-console">
      <section className="admin-section" id="agent-settings">
        <div className="admin-section__header">
          <div>
            <p className="eyebrow">Agent settings</p>
            <h2>Model, API_KEY, and retrieval</h2>
          </div>
          <span className="status-item">Effective model: {settings.effectiveModel}</span>
        </div>

        <form className="admin-form" onSubmit={saveSettings}>
          <label>
            <span>Provider routing</span>
            <select value={provider} onChange={(event) => onProviderChange(event.target.value as AgentProvider)}>
              <option value="silo">silo_ai_svc</option>
              <option value="openai">OpenAI direct</option>
            </select>
          </label>

          <label>
            <span>Model selection</span>
            <select
              value={model}
              onChange={(event) => onModelChange(event.target.value)}
              disabled={loadingModels || modelOptions.length === 0}
            >
              {modelOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.displayName} ({option.id})
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Reasoning effort</span>
            <select
              value={reasoningEffort}
              onChange={(event) => setReasoningEffort(event.target.value as AgentSettings["reasoningEffort"])}
              disabled={effortLevels.length === 0}
            >
              {effortLevels.length === 0 ? <option value="">Not supported by selected model</option> : null}
              {effortLevels.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>System API_KEY</span>
            <input
              type="password"
              value={systemApiKey}
              onChange={(event) => setSystemApiKey(event.target.value)}
              placeholder={settings.hasSystemApiKey ? "Stored. Leave blank to keep current value." : "No stored key"}
              autoComplete="off"
            />
          </label>

          <label className="admin-checkbox">
            <input
              type="checkbox"
              checked={clearSystemApiKey}
              onChange={(event) => setClearSystemApiKey(event.target.checked)}
            />
            <span>Clear stored System API_KEY</span>
          </label>

          <div className="admin-form__group">
            <div className="admin-form__group-head">
              <div>
                <p className="eyebrow">RAG retrieval limits</p>
                <h3>Source and episode budgets</h3>
              </div>
              <p>
                These values set the server-side defaults and caps for research, archive, and episode questions.
              </p>
            </div>
            <div className="admin-limit-grid">
              {retrievalFields.map((field) => (
                <label className="admin-limit-field" key={field.key}>
                  <span>{field.label}</span>
                  <input
                    type="number"
                    min={field.min}
                    max={field.max}
                    step="1"
                    value={retrieval[field.key]}
                    onChange={(event) => onRetrievalChange(field.key, event.target.value)}
                  />
                  <small>{field.help} Range: {field.min}-{field.max}.</small>
                </label>
              ))}
            </div>
          </div>

          <button className="button button--primary" type="submit" disabled={savingSettings}>
            {savingSettings ? "Saving..." : "Save agent settings"}
          </button>
        </form>

        <div className="status-list status-list--compact">
          <span>
            <strong>Model catalog</strong>
            {loadingModels ? "Loading supported models" : `${modelCatalog.models.length} model${modelCatalog.models.length === 1 ? "" : "s"} from ${modelCatalog.source}`}
            {modelCatalog.error ? ` (${modelCatalog.error})` : ""}
          </span>
          <span>
            <strong>Reasoning effort</strong>
            {reasoningEffort || "Not sent"}
          </span>
          <span>
            <strong>Stored key</strong>
            {settings.hasSystemApiKey ? `Present, updated ${formatDate(settings.systemApiKeyUpdatedAt)}` : "Not stored"}
          </span>
          <span>
            <strong>Research limits</strong>
            {settings.retrieval.researchSourceBudget} per lane, {settings.retrieval.researchMaxSources} cited sources
          </span>
          <span>
            <strong>Archive limits</strong>
            {settings.retrieval.archiveTopK} matches, {settings.retrieval.archiveMaxSources} cited sources
          </span>
          <span>
            <strong>Last settings update</strong>
            {formatDate(settings.updatedAt)}
            {settings.updatedBy ? ` by ${settings.updatedBy}` : ""}
          </span>
        </div>

        {settingsMessage ? <p className="empty-state empty-state--success">{settingsMessage}</p> : null}
        {settingsError ? <p className="empty-state empty-state--error">{settingsError}</p> : null}
      </section>

      <section className="admin-section" id="user-security">
        <div className="admin-section__header">
          <div>
            <p className="eyebrow">User security</p>
            <h2>Role assignment</h2>
          </div>
          <span className="status-item">{users.length} known user{users.length === 1 ? "" : "s"}</span>
        </div>

        <form className="admin-role-form" onSubmit={assignNewRole}>
          <label>
            <span>Email</span>
            <input
              type="email"
              value={roleEmail}
              onChange={(event) => setRoleEmail(event.target.value)}
              placeholder="person@example.com"
            />
          </label>
          <label>
            <span>Role</span>
            <select value={role} onChange={(event) => setRole(event.target.value as AicRole)}>
              <option value="User">User</option>
              <option value="Admin">Admin</option>
            </select>
          </label>
          <button className="button button--primary" type="submit" disabled={Boolean(savingRole) || !roleEmail.trim()}>
            Assign role
          </button>
        </form>

        <div className="admin-user-table" role="table" aria-label="Known AIC users">
          <div className="admin-user-table__head" role="row">
            <span role="columnheader">User</span>
            <span role="columnheader">Role</span>
            <span role="columnheader">Last seen</span>
            <span role="columnheader">Action</span>
          </div>
          {users.map((user) => (
            <div className="admin-user-table__row" role="row" key={user.email}>
              <span role="cell">
                <strong>{user.email}</strong>
                <small>{user.name || "Name not recorded"}</small>
              </span>
              <span role="cell">
                <select
                  id={`role-${user.email}`}
                  value={user.role}
                  onChange={(event) => saveRole(user.email, event.target.value as AicRole)}
                  disabled={Boolean(savingRole)}
                  aria-label={`Role for ${user.email}`}
                >
                  <option value="User">User</option>
                  <option value="Admin">Admin</option>
                </select>
              </span>
              <span role="cell">{formatDate(user.lastSeenAt)}</span>
              <button
                className="button button--ghost"
                type="button"
                onClick={() => saveRole(user.email, user.role)}
                disabled={savingRole === user.email}
              >
                {savingRole === user.email ? "Saving..." : "Save"}
              </button>
            </div>
          ))}
        </div>

        {roleMessage ? <p className="empty-state empty-state--success">{roleMessage}</p> : null}
        {roleError ? <p className="empty-state empty-state--error">{roleError}</p> : null}
      </section>
    </div>
  );
}
