"use client";

import { FormEvent, useState } from "react";

type AicRole = "User" | "Admin";
type AgentProvider = "silo" | "openai";

type AgentSettings = {
  provider: AgentProvider;
  model: string;
  effectiveModel: string;
  hasSystemApiKey: boolean;
  systemApiKeyUpdatedAt: string | null;
  updatedBy: string;
  updatedAt: string | null;
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
};

const modelOptions = [
  "openai-codex/gpt-5.5",
  "openai-codex/gpt-5.4",
  "gpt-5.4-mini",
  "gpt-4.1-mini",
  "gpt-4.1",
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

export function AdminConsole({ initialSettings, initialUsers }: AdminConsoleProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [provider, setProvider] = useState<AgentProvider>(initialSettings.provider);
  const [model, setModel] = useState(initialSettings.model || initialSettings.effectiveModel);
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
      <section className="admin-section">
        <div className="admin-section__header">
          <div>
            <p className="eyebrow">Agent settings</p>
            <h2>Model and system API_KEY</h2>
          </div>
          <span className="status-item">Effective model: {settings.effectiveModel}</span>
        </div>

        <form className="admin-form" onSubmit={saveSettings}>
          <label>
            <span>Provider routing</span>
            <select value={provider} onChange={(event) => setProvider(event.target.value as AgentProvider)}>
              <option value="silo">silo_ai_svc</option>
              <option value="openai">OpenAI direct</option>
            </select>
          </label>

          <label>
            <span>Model selection</span>
            <input
              list="agent-model-options"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={settings.effectiveModel}
            />
            <datalist id="agent-model-options">
              {modelOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
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

          <button className="button button--primary" type="submit" disabled={savingSettings}>
            {savingSettings ? "Saving..." : "Save agent settings"}
          </button>
        </form>

        <div className="status-list status-list--compact">
          <span>
            <strong>Stored key</strong>
            {settings.hasSystemApiKey ? `Present, updated ${formatDate(settings.systemApiKeyUpdatedAt)}` : "Not stored"}
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

      <section className="admin-section">
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
