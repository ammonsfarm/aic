import "server-only";

import { queryRows } from "@/lib/db";

export type AgentProvider = "silo" | "openai";

export type AgentSettingsView = {
  provider: AgentProvider;
  model: string;
  effectiveModel: string;
  hasSystemApiKey: boolean;
  systemApiKeyUpdatedAt: string | null;
  updatedBy: string;
  updatedAt: string | null;
};

export type AgentRuntimeSettings = {
  provider: AgentProvider;
  model: string;
  systemApiKey: string;
};

type AgentSettingsRow = {
  provider: string | null;
  model: string | null;
  system_api_key: string | null;
  system_api_key_updated_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

const DEFAULT_PROVIDER: AgentProvider = "silo";

function normalizeProvider(value: unknown): AgentProvider {
  return value === "openai" ? "openai" : DEFAULT_PROVIDER;
}

function defaultModel(provider: AgentProvider) {
  if (provider === "openai") {
    return process.env.OPENAI_CHAT_MODEL || process.env.OPENAI_RAG_MODEL?.replace(/^openai-codex\//, "") || "gpt-4.1-mini";
  }

  return process.env.OPENAI_RAG_MODEL || "gpt-5.4-mini";
}

async function readSettingsRow() {
  const rows = await queryRows<AgentSettingsRow>(
    `
      select
        provider,
        model,
        system_api_key,
        system_api_key_updated_at::text,
        updated_by,
        updated_at::text
      from agent_settings
      where settings_key = 'default'
      limit 1
    `,
  );

  return rows[0] ?? null;
}

export async function getAgentSettingsView(): Promise<AgentSettingsView> {
  const row = await readSettingsRow();
  const provider = normalizeProvider(row?.provider);
  const model = row?.model?.trim() ?? "";

  return {
    provider,
    model,
    effectiveModel: model || defaultModel(provider),
    hasSystemApiKey: Boolean(row?.system_api_key),
    systemApiKeyUpdatedAt: row?.system_api_key_updated_at ?? null,
    updatedBy: row?.updated_by ?? "",
    updatedAt: row?.updated_at ?? null,
  };
}

export async function getAgentRuntimeSettings(requestedProvider?: string): Promise<AgentRuntimeSettings> {
  const row = await readSettingsRow();
  const provider = normalizeProvider(requestedProvider ?? row?.provider);
  const model = row?.model?.trim() || defaultModel(provider);
  const savedKey = row?.system_api_key?.trim() ?? "";

  return {
    provider,
    model,
    systemApiKey: savedKey,
  };
}

export async function saveAgentSettings({
  provider,
  model,
  systemApiKey,
  clearSystemApiKey,
  updatedBy,
}: {
  provider: AgentProvider;
  model: string;
  systemApiKey?: string;
  clearSystemApiKey?: boolean;
  updatedBy: string;
}) {
  const normalizedModel = model.trim();
  const trimmedApiKey = systemApiKey?.trim() ?? "";

  if (normalizedModel.length > 160) {
    throw new Error("Model name must be 160 characters or fewer.");
  }

  if (trimmedApiKey.length > 4_000) {
    throw new Error("System API_KEY is too long.");
  }

  if (clearSystemApiKey) {
    await queryRows(
      `
        insert into agent_settings(settings_key, provider, model, system_api_key, system_api_key_updated_at, updated_by, updated_at)
        values ('default', $1, $2, '', null, $3, now())
        on conflict (settings_key) do update
        set provider = excluded.provider,
            model = excluded.model,
            system_api_key = '',
            system_api_key_updated_at = null,
            updated_by = excluded.updated_by,
            updated_at = now()
      `,
      [provider, normalizedModel, updatedBy],
    );
  } else if (trimmedApiKey) {
    await queryRows(
      `
        insert into agent_settings(settings_key, provider, model, system_api_key, system_api_key_updated_at, updated_by, updated_at)
        values ('default', $1, $2, $3, now(), $4, now())
        on conflict (settings_key) do update
        set provider = excluded.provider,
            model = excluded.model,
            system_api_key = excluded.system_api_key,
            system_api_key_updated_at = now(),
            updated_by = excluded.updated_by,
            updated_at = now()
      `,
      [provider, normalizedModel, trimmedApiKey, updatedBy],
    );
  } else {
    await queryRows(
      `
        insert into agent_settings(settings_key, provider, model, updated_by, updated_at)
        values ('default', $1, $2, $3, now())
        on conflict (settings_key) do update
        set provider = excluded.provider,
            model = excluded.model,
            updated_by = excluded.updated_by,
            updated_at = now()
      `,
      [provider, normalizedModel, updatedBy],
    );
  }

  return getAgentSettingsView();
}
