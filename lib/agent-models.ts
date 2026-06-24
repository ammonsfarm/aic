import "server-only";

export type AgentReasoningEffort = "low" | "medium" | "high";

export type AgentModelOption = {
  id: string;
  displayName: string;
  provider: string;
  ownedBy: string;
  availability: string;
  reasoningEffortLevels: AgentReasoningEffort[];
};

type RawModel = {
  id?: unknown;
  display_name?: unknown;
  provider?: unknown;
  owned_by?: unknown;
  capabilities?: {
    reasoning?: {
      effort_levels?: unknown;
    };
    availability?: {
      status?: unknown;
    };
  };
};

type ModelsResponse = {
  data?: unknown;
};

const FALLBACK_SILO_MODELS: AgentModelOption[] = [
  {
    id: "openai-codex/gpt-5.5",
    displayName: "gpt-5.5",
    provider: "openai-codex",
    ownedBy: "silo_ai_svc",
    availability: "fallback",
    reasoningEffortLevels: ["low", "medium", "high"],
  },
  {
    id: "openai-codex/gpt-5.4",
    displayName: "gpt-5.4",
    provider: "openai-codex",
    ownedBy: "silo_ai_svc",
    availability: "fallback",
    reasoningEffortLevels: ["low", "medium", "high"],
  },
  {
    id: "openai-codex/gpt-5.4-mini",
    displayName: "gpt-5.4-mini",
    provider: "openai-codex",
    ownedBy: "silo_ai_svc",
    availability: "fallback",
    reasoningEffortLevels: ["low", "medium", "high"],
  },
];

const OPENAI_DIRECT_MODELS: AgentModelOption[] = [
  {
    id: "gpt-4.1-mini",
    displayName: "gpt-4.1-mini",
    provider: "openai",
    ownedBy: "openai",
    availability: "configured",
    reasoningEffortLevels: [],
  },
  {
    id: "gpt-4.1",
    displayName: "gpt-4.1",
    provider: "openai",
    ownedBy: "openai",
    availability: "configured",
    reasoningEffortLevels: [],
  },
];

function siloModelsUrl() {
  const configured = process.env.SILO_MODELS_URL;
  if (configured) {
    return configured;
  }

  const chatUrl = process.env.SILO_CHAT_URL ?? "http://192.168.1.195:4041/v1/chat/completions";
  return chatUrl.replace(/\/chat\/completions\/?$/, "/models");
}

function normalizeEffort(value: unknown): AgentReasoningEffort | null {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }

  return null;
}

function normalizeModel(entry: RawModel): AgentModelOption | null {
  if (typeof entry.id !== "string" || !entry.id.trim()) {
    return null;
  }

  const levels = Array.isArray(entry.capabilities?.reasoning?.effort_levels)
    ? entry.capabilities.reasoning.effort_levels.map(normalizeEffort).filter((level): level is AgentReasoningEffort => Boolean(level))
    : [];

  return {
    id: entry.id.trim(),
    displayName: typeof entry.display_name === "string" && entry.display_name.trim() ? entry.display_name.trim() : entry.id.trim(),
    provider: typeof entry.provider === "string" ? entry.provider : "",
    ownedBy: typeof entry.owned_by === "string" ? entry.owned_by : "",
    availability: typeof entry.capabilities?.availability?.status === "string" ? entry.capabilities.availability.status : "",
    reasoningEffortLevels: [...new Set(levels)],
  };
}

export function normalizeReasoningEffort(value: unknown): AgentReasoningEffort | "" {
  return normalizeEffort(value) ?? "";
}

export async function getSupportedAgentModels(provider: "silo" | "openai" = "silo") {
  if (provider === "openai") {
    return {
      models: OPENAI_DIRECT_MODELS,
      source: "openai-direct-static",
      error: "",
    };
  }

  const token = process.env.SILO_TEMP_KEY;
  if (!token) {
    return {
      models: FALLBACK_SILO_MODELS,
      source: "fallback",
      error: "SILO_TEMP_KEY is not configured.",
    };
  }

  try {
    const response = await fetch(siloModelsUrl(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        models: FALLBACK_SILO_MODELS,
        source: "fallback",
        error: `Silo models request failed (${response.status}).`,
      };
    }

    const payload = (await response.json()) as ModelsResponse;
    const data = Array.isArray(payload.data) ? payload.data : [];
    const models = data
      .map((entry) => normalizeModel(entry as RawModel))
      .filter((entry): entry is AgentModelOption => Boolean(entry))
      .sort((a, b) => a.id.localeCompare(b.id));

    return {
      models: models.length ? models : FALLBACK_SILO_MODELS,
      source: models.length ? siloModelsUrl() : "fallback",
      error: models.length ? "" : "Silo model list was empty.",
    };
  } catch (error) {
    return {
      models: FALLBACK_SILO_MODELS,
      source: "fallback",
      error: error instanceof Error ? error.message : "Silo models request failed.",
    };
  }
}
