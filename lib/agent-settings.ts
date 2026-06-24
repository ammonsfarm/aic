import "server-only";

import { normalizeReasoningEffort, type AgentReasoningEffort } from "@/lib/agent-models";
import { queryRows } from "@/lib/db";

export type AgentProvider = "silo" | "openai";

export type RagRetrievalSettings = {
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

type RetrievalKey = keyof RagRetrievalSettings;

type RetrievalLimit = {
  defaultValue: number;
  min: number;
  max: number;
};

export const RAG_RETRIEVAL_LIMITS: Record<RetrievalKey, RetrievalLimit> = {
  archiveTopK: { defaultValue: 10, min: 1, max: 40 },
  archiveMaxSources: { defaultValue: 16, min: 1, max: 40 },
  researchSourceBudget: { defaultValue: 24, min: 8, max: 60 },
  researchCandidateEpisodes: { defaultValue: 8, min: 1, max: 20 },
  researchSummaryEpisodes: { defaultValue: 6, min: 0, max: 12 },
  researchDetailExcerpts: { defaultValue: 30, min: 0, max: 60 },
  researchMaxSources: { defaultValue: 40, min: 8, max: 80 },
  researchInterviewInventoryLimit: { defaultValue: 60, min: 0, max: 120 },
  researchInterviewMaxSources: { defaultValue: 72, min: 8, max: 120 },
};

export type AgentSettingsView = {
  provider: AgentProvider;
  model: string;
  effectiveModel: string;
  reasoningEffort: AgentReasoningEffort | "";
  retrieval: RagRetrievalSettings;
  hasSystemApiKey: boolean;
  systemApiKeyUpdatedAt: string | null;
  updatedBy: string;
  updatedAt: string | null;
};

export type AgentRuntimeSettings = {
  provider: AgentProvider;
  model: string;
  reasoningEffort: AgentReasoningEffort | "";
  systemApiKey: string;
};

type AgentSettingsRow = {
  provider: string | null;
  model: string | null;
  reasoning_effort: string | null;
  system_api_key: string | null;
  system_api_key_updated_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
  rag_archive_top_k: number | null;
  rag_archive_max_sources: number | null;
  rag_research_source_budget: number | null;
  rag_research_candidate_episodes: number | null;
  rag_research_summary_episodes: number | null;
  rag_research_detail_excerpts: number | null;
  rag_research_max_sources: number | null;
  rag_research_interview_inventory_limit: number | null;
  rag_research_interview_max_sources: number | null;
};

const DEFAULT_PROVIDER: AgentProvider = "silo";
const DEFAULT_RAG_RETRIEVAL_SETTINGS = Object.fromEntries(
  Object.entries(RAG_RETRIEVAL_LIMITS).map(([key, limits]) => [key, limits.defaultValue]),
) as RagRetrievalSettings;

const RETRIEVAL_COLUMNS: Record<RetrievalKey, keyof AgentSettingsRow> = {
  archiveTopK: "rag_archive_top_k",
  archiveMaxSources: "rag_archive_max_sources",
  researchSourceBudget: "rag_research_source_budget",
  researchCandidateEpisodes: "rag_research_candidate_episodes",
  researchSummaryEpisodes: "rag_research_summary_episodes",
  researchDetailExcerpts: "rag_research_detail_excerpts",
  researchMaxSources: "rag_research_max_sources",
  researchInterviewInventoryLimit: "rag_research_interview_inventory_limit",
  researchInterviewMaxSources: "rag_research_interview_max_sources",
};

function normalizeProvider(value: unknown): AgentProvider {
  return value === "openai" ? "openai" : DEFAULT_PROVIDER;
}

function clampInteger(value: unknown, limits: RetrievalLimit, fallback: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(limits.min, Math.min(limits.max, Math.trunc(numeric)));
}

function normalizeRetrievalSettings(row?: Partial<AgentSettingsRow> | null): RagRetrievalSettings {
  return (Object.keys(RAG_RETRIEVAL_LIMITS) as RetrievalKey[]).reduce((settings, key) => {
    const limits = RAG_RETRIEVAL_LIMITS[key];
    const column = RETRIEVAL_COLUMNS[key];
    settings[key] = clampInteger(row?.[column], limits, limits.defaultValue);
    return settings;
  }, { ...DEFAULT_RAG_RETRIEVAL_SETTINGS });
}

function normalizeRetrievalInput(
  input: Partial<Record<RetrievalKey, unknown>> | undefined,
  fallback: RagRetrievalSettings,
): RagRetrievalSettings {
  return (Object.keys(RAG_RETRIEVAL_LIMITS) as RetrievalKey[]).reduce((settings, key) => {
    settings[key] = clampInteger(input?.[key], RAG_RETRIEVAL_LIMITS[key], fallback[key]);
    return settings;
  }, { ...fallback });
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
        reasoning_effort,
        system_api_key,
        system_api_key_updated_at::text,
        updated_by,
        updated_at::text,
        rag_archive_top_k,
        rag_archive_max_sources,
        rag_research_source_budget,
        rag_research_candidate_episodes,
        rag_research_summary_episodes,
        rag_research_detail_excerpts,
        rag_research_max_sources,
        rag_research_interview_inventory_limit,
        rag_research_interview_max_sources
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
    reasoningEffort: normalizeReasoningEffort(row?.reasoning_effort),
    retrieval: normalizeRetrievalSettings(row),
    hasSystemApiKey: Boolean(row?.system_api_key),
    systemApiKeyUpdatedAt: row?.system_api_key_updated_at ?? null,
    updatedBy: row?.updated_by ?? "",
    updatedAt: row?.updated_at ?? null,
  };
}

export async function getRagRetrievalSettings(): Promise<RagRetrievalSettings> {
  return normalizeRetrievalSettings(await readSettingsRow());
}

export async function getAgentRuntimeSettings(requestedProvider?: string): Promise<AgentRuntimeSettings> {
  const row = await readSettingsRow();
  const provider = normalizeProvider(requestedProvider ?? row?.provider);
  const model = row?.model?.trim() || defaultModel(provider);
  const reasoningEffort = normalizeReasoningEffort(row?.reasoning_effort);
  const savedKey = row?.system_api_key?.trim() ?? "";

  return {
    provider,
    model,
    reasoningEffort,
    systemApiKey: savedKey,
  };
}

export async function saveAgentSettings({
  provider,
  model,
  reasoningEffort,
  retrieval,
  systemApiKey,
  clearSystemApiKey,
  updatedBy,
}: {
  provider: AgentProvider;
  model: string;
  reasoningEffort?: string;
  retrieval?: Partial<Record<RetrievalKey, unknown>>;
  systemApiKey?: string;
  clearSystemApiKey?: boolean;
  updatedBy: string;
}) {
  const existingRow = await readSettingsRow();
  const normalizedRetrieval = normalizeRetrievalInput(
    retrieval,
    normalizeRetrievalSettings(existingRow),
  );
  const normalizedModel = model.trim();
  const normalizedReasoningEffort = normalizeReasoningEffort(reasoningEffort);
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
        insert into agent_settings(
          settings_key,
          provider,
          model,
          reasoning_effort,
          system_api_key,
          system_api_key_updated_at,
          updated_by,
          updated_at,
          rag_archive_top_k,
          rag_archive_max_sources,
          rag_research_source_budget,
          rag_research_candidate_episodes,
          rag_research_summary_episodes,
          rag_research_detail_excerpts,
          rag_research_max_sources,
          rag_research_interview_inventory_limit,
          rag_research_interview_max_sources
        )
        values ('default', $1, $2, $3, '', null, $4, now(), $5, $6, $7, $8, $9, $10, $11, $12, $13)
        on conflict (settings_key) do update
        set provider = excluded.provider,
            model = excluded.model,
            reasoning_effort = excluded.reasoning_effort,
            system_api_key = '',
            system_api_key_updated_at = null,
            updated_by = excluded.updated_by,
            updated_at = now(),
            rag_archive_top_k = excluded.rag_archive_top_k,
            rag_archive_max_sources = excluded.rag_archive_max_sources,
            rag_research_source_budget = excluded.rag_research_source_budget,
            rag_research_candidate_episodes = excluded.rag_research_candidate_episodes,
            rag_research_summary_episodes = excluded.rag_research_summary_episodes,
            rag_research_detail_excerpts = excluded.rag_research_detail_excerpts,
            rag_research_max_sources = excluded.rag_research_max_sources,
            rag_research_interview_inventory_limit = excluded.rag_research_interview_inventory_limit,
            rag_research_interview_max_sources = excluded.rag_research_interview_max_sources
      `,
      [
        provider,
        normalizedModel,
        normalizedReasoningEffort,
        updatedBy,
        normalizedRetrieval.archiveTopK,
        normalizedRetrieval.archiveMaxSources,
        normalizedRetrieval.researchSourceBudget,
        normalizedRetrieval.researchCandidateEpisodes,
        normalizedRetrieval.researchSummaryEpisodes,
        normalizedRetrieval.researchDetailExcerpts,
        normalizedRetrieval.researchMaxSources,
        normalizedRetrieval.researchInterviewInventoryLimit,
        normalizedRetrieval.researchInterviewMaxSources,
      ],
    );
  } else if (trimmedApiKey) {
    await queryRows(
      `
        insert into agent_settings(
          settings_key,
          provider,
          model,
          reasoning_effort,
          system_api_key,
          system_api_key_updated_at,
          updated_by,
          updated_at,
          rag_archive_top_k,
          rag_archive_max_sources,
          rag_research_source_budget,
          rag_research_candidate_episodes,
          rag_research_summary_episodes,
          rag_research_detail_excerpts,
          rag_research_max_sources,
          rag_research_interview_inventory_limit,
          rag_research_interview_max_sources
        )
        values ('default', $1, $2, $3, $4, now(), $5, now(), $6, $7, $8, $9, $10, $11, $12, $13, $14)
        on conflict (settings_key) do update
        set provider = excluded.provider,
            model = excluded.model,
            reasoning_effort = excluded.reasoning_effort,
            system_api_key = excluded.system_api_key,
            system_api_key_updated_at = now(),
            updated_by = excluded.updated_by,
            updated_at = now(),
            rag_archive_top_k = excluded.rag_archive_top_k,
            rag_archive_max_sources = excluded.rag_archive_max_sources,
            rag_research_source_budget = excluded.rag_research_source_budget,
            rag_research_candidate_episodes = excluded.rag_research_candidate_episodes,
            rag_research_summary_episodes = excluded.rag_research_summary_episodes,
            rag_research_detail_excerpts = excluded.rag_research_detail_excerpts,
            rag_research_max_sources = excluded.rag_research_max_sources,
            rag_research_interview_inventory_limit = excluded.rag_research_interview_inventory_limit,
            rag_research_interview_max_sources = excluded.rag_research_interview_max_sources
      `,
      [
        provider,
        normalizedModel,
        normalizedReasoningEffort,
        trimmedApiKey,
        updatedBy,
        normalizedRetrieval.archiveTopK,
        normalizedRetrieval.archiveMaxSources,
        normalizedRetrieval.researchSourceBudget,
        normalizedRetrieval.researchCandidateEpisodes,
        normalizedRetrieval.researchSummaryEpisodes,
        normalizedRetrieval.researchDetailExcerpts,
        normalizedRetrieval.researchMaxSources,
        normalizedRetrieval.researchInterviewInventoryLimit,
        normalizedRetrieval.researchInterviewMaxSources,
      ],
    );
  } else {
    await queryRows(
      `
        insert into agent_settings(
          settings_key,
          provider,
          model,
          reasoning_effort,
          updated_by,
          updated_at,
          rag_archive_top_k,
          rag_archive_max_sources,
          rag_research_source_budget,
          rag_research_candidate_episodes,
          rag_research_summary_episodes,
          rag_research_detail_excerpts,
          rag_research_max_sources,
          rag_research_interview_inventory_limit,
          rag_research_interview_max_sources
        )
        values ('default', $1, $2, $3, $4, now(), $5, $6, $7, $8, $9, $10, $11, $12, $13)
        on conflict (settings_key) do update
        set provider = excluded.provider,
            model = excluded.model,
            reasoning_effort = excluded.reasoning_effort,
            updated_by = excluded.updated_by,
            updated_at = now(),
            rag_archive_top_k = excluded.rag_archive_top_k,
            rag_archive_max_sources = excluded.rag_archive_max_sources,
            rag_research_source_budget = excluded.rag_research_source_budget,
            rag_research_candidate_episodes = excluded.rag_research_candidate_episodes,
            rag_research_summary_episodes = excluded.rag_research_summary_episodes,
            rag_research_detail_excerpts = excluded.rag_research_detail_excerpts,
            rag_research_max_sources = excluded.rag_research_max_sources,
            rag_research_interview_inventory_limit = excluded.rag_research_interview_inventory_limit,
            rag_research_interview_max_sources = excluded.rag_research_interview_max_sources
      `,
      [
        provider,
        normalizedModel,
        normalizedReasoningEffort,
        updatedBy,
        normalizedRetrieval.archiveTopK,
        normalizedRetrieval.archiveMaxSources,
        normalizedRetrieval.researchSourceBudget,
        normalizedRetrieval.researchCandidateEpisodes,
        normalizedRetrieval.researchSummaryEpisodes,
        normalizedRetrieval.researchDetailExcerpts,
        normalizedRetrieval.researchMaxSources,
        normalizedRetrieval.researchInterviewInventoryLimit,
        normalizedRetrieval.researchInterviewMaxSources,
      ],
    );
  }

  return getAgentSettingsView();
}
