import { queryRows } from "@/lib/db";
import {
  getAgentRuntimeSettings,
  getRagRetrievalSettings,
  type AgentProvider,
  type RagRetrievalSettings,
} from "@/lib/agent-settings";
import {
  getEpisodeRagSources,
  getEpisodeSummarySources,
  getPastorWoodPostRagSources,
  type EpisodeChatSource,
} from "@/lib/podcast-data";

export type RagProvider = AgentProvider;

export type RagTokenUsage = {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
};

type RagChatSource = {
  citationId: string;
  lane?: string;
  sourceType: string;
  trackId: string;
  title: string;
  publishDate: string;
  segmentId: string;
  snippet: string;
  text: string;
  startTime: string;
  endTime: string;
  speakers: string[];
  score: number;
  vectorModel: string;
  sourceUrl?: string;
};

type RagChatResponse = {
  answer: string;
  query: string;
  provider: string;
  model: string;
  sources: RagChatSource[];
  topEpisodeIds: string[];
  retrievalLanes?: ResearchLane[];
  coverageNote?: string;
  escalated?: boolean;
  detailEpisodeIds?: string[];
  usage?: RagTokenUsage;
  usageJson?: unknown;
};

type ResearchLane = {
  id: string;
  label: string;
  description: string;
  sourceCount: number;
  episodeCount: number;
};

type ResearchSearchRow = {
  source_type: string;
  track_id: string;
  title: string;
  publish_date: string;
  custom_id: string;
  text: string;
  start_time: string | null;
  end_time: string | null;
  speakers: unknown;
  score: number;
  source_model: string | null;
  source_url?: string | null;
};

type SpeakerField = {
  name?: unknown;
};

function normalizeRequestedProvider(value: string | undefined): RagProvider | undefined {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "silo" || normalized === "openai") {
    return normalized;
  }

  return undefined;
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeSpeakers(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry.trim();
      }

      if (entry && typeof entry === "object") {
        const candidate = (entry as SpeakerField).name;
        return typeof candidate === "string" ? candidate.trim() : "";
      }

      return "";
    })
    .filter((entry): entry is string => entry.length > 0);
}

function formatSourceContext(sources: EpisodeChatSource[]) {
  return sources
    .map((source, index) => {
      const label = `S${index + 1}`;
      const when = source.startTime || source.endTime ? ` (${source.startTime || "?"}-${source.endTime || "?"})` : "";
      return `[${label}] ${source.title}${when}\n` +
        `Track ${source.trackId} (${source.vectorModel || "embedding"}) ${source.sourceType}\n${truncateText(source.text, 850)}`;
    })
    .join("\n\n");
}

function formatResearchSourceContext(sources: RagChatSource[]) {
  return sources
    .map((source) => {
      const when = source.startTime || source.endTime ? ` (${source.startTime || "?"}-${source.endTime || "?"})` : "";
      const lane = source.lane ? ` • lane: ${source.lane}` : "";
      if (source.sourceType.startsWith("pastorwood.")) {
        const sourceUrl = source.sourceUrl ? `\n${source.sourceUrl}` : "";
        return `[${source.citationId}] ${source.title}${lane}\n` +
          `Pastor Wood post ${source.trackId} (${source.vectorModel || "indexed"}) ${source.sourceType}${sourceUrl}\n${truncateText(source.text, 720)}`;
      }
      return `[${source.citationId}] ${source.title}${when}${lane}\n` +
        `Track ${source.trackId} (${source.vectorModel || "indexed"}) ${source.sourceType}\n${truncateText(source.text, 720)}`;
    })
    .join("\n\n");
}

async function extractChatText(payload: unknown): Promise<string> {
  if (typeof payload !== "object" || payload === null) {
    return "";
  }

  const candidate = payload as {
    choices?: Array<{ message?: { content?: unknown } }>;
    response?: { output?: Array<{ content?: Array<{ text?: { value?: unknown } }> }> };
    output_text?: unknown;
    output?: unknown;
  };

  const message = candidate.choices?.[0]?.message?.content;
  if (typeof message === "string" && message.trim().length > 0) {
    return message;
  }

  const outputText = candidate.output_text;
  if (typeof outputText === "string" && outputText.trim().length > 0) {
    return outputText;
  }

  const responseText = candidate.response?.output?.[0]?.content?.[0]?.text?.value;
  if (typeof responseText === "string" && responseText.trim().length > 0) {
    return responseText;
  }

  const looseOutput = candidate.output;
  if (typeof looseOutput === "string" && looseOutput.trim().length > 0) {
    return looseOutput;
  }

  return "";
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : null;
}

function extractUsagePayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as { usage?: unknown };
  return candidate.usage && typeof candidate.usage === "object" ? candidate.usage as Record<string, unknown> : null;
}

function extractTokenUsage(payload: unknown): RagTokenUsage {
  const usage = extractUsagePayload(payload);
  if (!usage) {
    return { total_tokens: 0, input_tokens: 0, output_tokens: 0 };
  }

  let inputTokens =
    numberField(usage.input_tokens) ??
    numberField(usage.prompt_tokens) ??
    numberField(usage.inputTokens) ??
    numberField(usage.promptTokens) ??
    0;
  let outputTokens =
    numberField(usage.output_tokens) ??
    numberField(usage.completion_tokens) ??
    numberField(usage.outputTokens) ??
    numberField(usage.completionTokens) ??
    0;
  let totalTokens =
    numberField(usage.total_tokens) ??
    numberField(usage.totalTokens) ??
    numberField(usage.total) ??
    0;

  if (!totalTokens && (inputTokens || outputTokens)) {
    totalTokens = inputTokens + outputTokens;
  }

  if (!inputTokens && totalTokens && outputTokens) {
    inputTokens = Math.max(0, totalTokens - outputTokens);
  }

  if (!outputTokens && totalTokens && inputTokens) {
    outputTokens = Math.max(0, totalTokens - inputTokens);
  }

  return {
    total_tokens: totalTokens,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  };
}

async function callSiloEndpoint(
  messages: Array<{ role: string; content: string }>,
  model: string,
  savedApiKey = "",
  reasoningEffort = "",
) {
  const url = process.env.SILO_CHAT_URL ?? "http://192.168.1.195:4041/v1/chat/completions";
  const token = savedApiKey || process.env.SILO_TEMP_KEY;

  if (!token) {
    throw new Error("SILO_TEMP_KEY is not configured");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      backend_mode: "codex-direct",
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
      messages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Silo chat request failed (${response.status}): ${details}`);
  }

  return response.json();
}

async function callOpenAiEndpoint(messages: Array<{ role: string; content: string }>, model: string, savedApiKey = "") {
  const token = savedApiKey || process.env.OPENAI_API_KEY;
  const url = process.env.OPENAI_CHAT_URL ?? "https://api.openai.com/v1/chat/completions";

  if (!token) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.5,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`OpenAI chat request failed (${response.status}): ${details}`);
  }

  return response.json();
}

async function callChatModel(
  messages: Array<{ role: string; content: string }>,
  provider: RagProvider | undefined,
): Promise<{ text: string; model: string; provider: RagProvider; usage: RagTokenUsage; usageJson: unknown }> {
  const runtime = await getAgentRuntimeSettings(provider);

  if (runtime.provider === "openai") {
    const output = await callOpenAiEndpoint(messages, runtime.model, runtime.systemApiKey);
    return {
      text: await extractChatText(output),
      model: runtime.model,
      provider: runtime.provider,
      usage: extractTokenUsage(output),
      usageJson: extractUsagePayload(output) ?? {},
    };
  }

  try {
    const output = await callSiloEndpoint(messages, runtime.model, runtime.systemApiKey, runtime.reasoningEffort);
    const text = await extractChatText(output);
    return {
      text,
      model: runtime.model,
      provider: runtime.provider,
      usage: extractTokenUsage(output),
      usageJson: extractUsagePayload(output) ?? {},
    };
  } catch (error) {
    if (error instanceof Error && process.env.OPENAI_API_KEY) {
      const fallbackModel = process.env.OPENAI_CHAT_MODEL || runtime.model.replace("openai-codex/", "");
      const output = await callOpenAiEndpoint(messages, fallbackModel);
      return {
        text: await extractChatText(output),
        model: fallbackModel,
        provider: "openai",
        usage: extractTokenUsage(output),
        usageJson: extractUsagePayload(output) ?? {},
      };
    }

    throw error;
  }
}

export async function callArchiveChatModel(
  messages: Array<{ role: string; content: string }>,
  provider?: RagProvider,
): Promise<{ text: string; model: string; usage: RagTokenUsage }> {
  const result = await callChatModel(messages, provider);
  return { text: result.text, model: result.model, usage: result.usage };
}

function buildPrompt(question: string, sources: EpisodeChatSource[]) {
  const sourceContext = formatSourceContext(sources);

  return [
    "You are a faithful sermon-research assistant for Pastor Jim Wood's sermon archive.",
    "Use only the provided source context to answer the question. If the answer is not in context, say you could not locate sufficient evidence.",
    "Treat transcript sources as primary evidence. Treat episode.summary sources as derived orientation unless a transcript source confirms the point.",
    "Return concise, topic-rich prose. Use citations in bracketed form like [S1], [S2], ... when you quote or directly rely on a source segment.",
    "Never invent episode metadata or dates.",
    "",
    "SOURCES:",
    sourceContext,
    "",
    `QUESTION: ${question}`,
  ].join("\n");
}

function buildSystemPrompt() {
  return "You are a grounded assistant that only answers using the provided sermon-research excerpts.";
}

function buildResearchSystemPrompt() {
  return "You are a careful archive research agent. You answer from supplied AIC corpus sources only, cite evidence, and label uncertainty.";
}

function buildResearchPrompt(question: string, sources: RagChatSource[], lanes: ResearchLane[], coverageNote: string) {
  const laneContext = lanes
    .map((lane) => `${lane.label}: ${lane.sourceCount} sources from ${lane.episodeCount} episodes. ${lane.description}`)
    .join("\n");

  return [
    "Answer the research question using only the supplied AIC corpus context, including Pastor Wood devotional posts when present.",
    "Use citations like [S1], [S2] for claims. If the retrieved context is only a sample, say so clearly.",
    "Prefer transcript/detail sources for sermon wording. Treat devotional posts as primary written-source evidence for devotional themes.",
    "Use structured intelligence as an index and orientation.",
    "For counting or inventory questions, count only the supplied structured inventory unless the context explicitly says the list is complete.",
    "Do not invent guests, dates, quotations, scripture references, or episode titles.",
    "",
    "RETRIEVAL LANES:",
    laneContext || "No retrieval lanes returned sources.",
    "",
    "COVERAGE NOTE:",
    coverageNote,
    "",
    "SOURCES:",
    formatResearchSourceContext(sources),
    "",
    `QUESTION: ${question}`,
  ].join("\n");
}

function isInterviewInventoryQuestion(question: string) {
  return /\b(interview|interviews|interviewing|guest|guests|conversation|conversations)\b/i.test(question);
}

function toResearchSources(rows: ResearchSearchRow[], lane: string): RagChatSource[] {
  return rows.map((row) => ({
    citationId: "",
    lane,
    sourceType: row.source_type,
    trackId: row.track_id,
    title: row.title,
    publishDate: row.publish_date,
    segmentId: row.custom_id,
    snippet: row.text,
    text: row.text,
    startTime: row.start_time ?? "",
    endTime: row.end_time ?? "",
    speakers: normalizeSpeakers(row.speakers),
    score: Number(row.score),
    vectorModel: row.source_model ?? "",
    sourceUrl: row.source_url ?? "",
  }));
}

function dedupeSources(sources: RagChatSource[]) {
  const seen = new Set<string>();
  const deduped: RagChatSource[] = [];

  for (const source of sources) {
    const key = `${source.lane ?? ""}:${source.sourceType}:${source.trackId}:${source.segmentId}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(source);
  }

  return deduped;
}

function summarizeLane(id: string, label: string, description: string, sources: RagChatSource[]): ResearchLane {
  return {
    id,
    label,
    description,
    sourceCount: sources.length,
    episodeCount: new Set(sources.map((source) => source.trackId)).size,
  };
}

async function getStructuredResearchSources(question: string, limit: number): Promise<RagChatSource[]> {
  const rows = await queryRows<ResearchSearchRow>(
    `
      with q as (
        select websearch_to_tsquery('english', $1) as query_ts
      ),
      matches as (
        select
          'structured.summary' as source_type,
          ei.track_id,
          coalesce(e.title, ei.title, 'Episode') as title,
          coalesce(e.publish_date, ei.publish_date, '') as publish_date,
          ei.track_id || ':summary' as custom_id,
          concat_ws(E'\n\n',
            nullif(ei.executive_summary, ''),
            nullif(ei.long_summary, '')
          ) as text,
          null::text as start_time,
          null::text as end_time,
          '[]'::jsonb as speakers,
          coalesce(ts_rank_cd(ei.search_tsv, q.query_ts), 0) as score,
          coalesce(ei.source_model, '') as source_model
        from episode_intelligence ei
        join episodes e on e.track_id = ei.track_id
        cross join q
        where q.query_ts @@ ei.search_tsv

        union all

        select
          'structured.' || coalesce(i.item_type, 'item') as source_type,
          i.track_id,
          coalesce(e.title, 'Episode') as title,
          coalesce(e.publish_date, '') as publish_date,
          i.id::text as custom_id,
          concat_ws(E'\n',
            nullif(i.label, ''),
            nullif(i.summary, ''),
            case when i.value_json is null then null else i.value_json::text end
          ) as text,
          null::text as start_time,
          null::text as end_time,
          coalesce(i.speakers, '[]'::jsonb) as speakers,
          coalesce(ts_rank_cd(i.search_tsv, q.query_ts), 0) + 0.05 as score,
          coalesce(ei.source_model, '') as source_model
        from episode_intelligence_items i
        join episodes e on e.track_id = i.track_id
        left join episode_intelligence ei on ei.track_id = i.track_id
        cross join q
        where q.query_ts @@ i.search_tsv
      )
      select *
      from matches
      where length(trim(text)) > 0
      order by score desc, publish_date desc nulls last
      limit $2
    `,
    [question, limit],
  );

  return toResearchSources(rows, "structured");
}

async function getInterviewInventorySources(limit: number): Promise<RagChatSource[]> {
  const rows = await queryRows<ResearchSearchRow>(
    `
      select
        'structured.interview_inventory' as source_type,
        i.track_id,
        coalesce(e.title, 'Episode') as title,
        coalesce(e.publish_date, '') as publish_date,
        i.id::text as custom_id,
        concat_ws(E'\n',
          nullif(i.label, ''),
          nullif(i.summary, ''),
          case when i.value_json is null then null else i.value_json::text end
        ) as text,
        null::text as start_time,
        null::text as end_time,
        coalesce(i.speakers, '[]'::jsonb) as speakers,
        0.72 as score,
        coalesce(ei.source_model, '') as source_model
      from episode_intelligence_items i
      join episodes e on e.track_id = i.track_id
      left join episode_intelligence ei on ei.track_id = i.track_id
      where i.item_type = 'interviews'
      order by nullif(e.publish_date, '')::date desc nulls last, e.title asc
      limit $1
    `,
    [limit],
  );

  return toResearchSources(rows, "structured inventory");
}

async function getTranscriptDetailSources(question: string, trackIds: string[], maxExcerpts: number): Promise<RagChatSource[]> {
  const uniqueTrackIds = [...new Set(trackIds.map((trackId) => trackId.trim()).filter(Boolean))];
  const excerptLimit = Math.max(0, Math.trunc(maxExcerpts));
  if (excerptLimit === 0) {
    return [];
  }

  const hitLimit = Math.max(3, Math.min(Math.ceil(excerptLimit / 3), 20));
  const rows = await queryRows<ResearchSearchRow>(
    `
      with q as (
        select websearch_to_tsquery('english', $1) as query_ts
      ),
      hits as (
        select
          ts.track_id,
          ts.segment_index,
          coalesce(ts_rank_cd(ts.search_tsv, q.query_ts), 0) as score
        from transcript_segments ts
        cross join q
        where q.query_ts @@ ts.search_tsv
          and (cardinality($2::text[]) = 0 or ts.track_id = any($2::text[]))
        order by score desc, ts.track_id, ts.segment_index
        limit $3
      ),
      context_rows as (
        select distinct on (ts.segment_id)
          'detail.transcript' as source_type,
          ts.track_id,
          coalesce(e.title, 'Episode') as title,
          coalesce(e.publish_date, '') as publish_date,
          ts.segment_id::text as custom_id,
          coalesce(ts.text, '') as text,
          ts.start_time,
          ts.end_time,
          jsonb_build_array(nullif(ts.speaker_name, '')) as speakers,
          h.score,
          'full transcript search' as source_model,
          ts.segment_index
        from hits h
        join transcript_segments ts
          on ts.track_id = h.track_id
         and ts.segment_index between h.segment_index - 1 and h.segment_index + 1
        join episodes e on e.track_id = ts.track_id
        where coalesce(ts.text, '') <> ''
        order by ts.segment_id, h.score desc
      )
      select
        source_type,
        track_id,
        title,
        publish_date,
        custom_id,
        text,
        start_time,
        end_time,
        speakers,
        score,
        source_model
      from context_rows
      order by score desc, track_id, segment_index
      limit $4
    `,
    [question, uniqueTrackIds, hitLimit, excerptLimit],
  );

  return toResearchSources(rows, "detail");
}

export async function runRagChat({
  query,
  trackId,
  topK,
  provider,
  retrievalSettings,
}: {
  query: string;
  trackId?: string;
  topK?: number;
  provider?: string;
  retrievalSettings?: RagRetrievalSettings;
}): Promise<RagChatResponse> {
  const question = query.trim();
  const retrieval = retrievalSettings ?? await getRagRetrievalSettings();
  const requestedTopK = typeof topK === "number" && Number.isFinite(topK)
    ? Math.trunc(topK)
    : retrieval.archiveTopK;
  const boundedTopK = Math.max(1, Math.min(requestedTopK, retrieval.archiveTopK));

  if (!question) {
    return {
      answer: "Ask a clear question about episodes, sermons, people, or scripture references.",
      query: "",
      provider: normalizeRequestedProvider(provider) ?? "silo",
      model: "",
      sources: [],
      topEpisodeIds: [],
    };
  }

  const sources = await getEpisodeRagSources(question, { trackId, topK: boundedTopK });
  if (!sources.length) {
    return {
      answer: "I could not find enough indexed sermon content to answer that question. Try a shorter phrasing or include a clearer topic reference.",
      query: question,
      provider: normalizeRequestedProvider(provider) ?? "silo",
      model: "",
      sources: [],
      topEpisodeIds: [],
    };
  }

  const episodeIdsForSummaries = [...new Set(sources.map((source) => source.trackId))].slice(0, 4);
  const summarySources = await getEpisodeSummarySources(episodeIdsForSummaries);
  const combinedSources = [...summarySources, ...sources];
  const sourceLimit = Math.max(1, Math.min(boundedTopK + 4, retrieval.archiveMaxSources));

  const limitedSources = combinedSources
    .slice(0, sourceLimit)
    .map((source) => ({
      citationId: "",
      sourceType: source.sourceType,
      trackId: source.trackId,
      title: source.title,
      publishDate: source.publishDate,
      segmentId: source.segmentId,
      snippet: source.text,
      text: source.text,
      startTime: source.startTime,
      endTime: source.endTime,
      speakers: source.speakers,
      score: source.score,
      vectorModel: source.vectorModel,
    }))
    .map((source, index) => ({
      ...source,
      citationId: `S${index + 1}`,
    }));

  const messages = [
    {
      role: "system",
      content: buildSystemPrompt(),
    },
    {
      role: "user",
      content: buildPrompt(question, limitedSources),
    },
  ];

  const selectedProvider = normalizeRequestedProvider(provider);
  const chatResult = await callChatModel(messages, selectedProvider);

  const text = chatResult.text || "The model returned no answer text. Try rephrasing the question.";
  const uniqueEpisodeIds = [...new Set(limitedSources.map((row) => row.trackId))];

  return {
    answer: text,
    query: question,
    provider: chatResult.provider,
    model: chatResult.model,
    sources: limitedSources,
    topEpisodeIds: uniqueEpisodeIds,
    usage: chatResult.usage,
    usageJson: chatResult.usageJson,
  };
}

export async function runResearchAgent({
  query,
  topK,
  provider,
  retrievalSettings,
}: {
  query: string;
  topK?: number;
  provider?: string;
  retrievalSettings?: RagRetrievalSettings;
}): Promise<RagChatResponse> {
  const question = query.trim();
  const selectedProvider = normalizeRequestedProvider(provider);
  const retrieval = retrievalSettings ?? await getRagRetrievalSettings();

  if (!question) {
    return {
      answer: "Ask a research question about episodes, guests, scripture passages, sermon illustrations, or themes.",
      query: "",
      provider: normalizeRequestedProvider(provider) ?? "silo",
      model: "",
      sources: [],
      topEpisodeIds: [],
      retrievalLanes: [],
      coverageNote: "",
      escalated: false,
      detailEpisodeIds: [],
    };
  }

  const requestedTopK = typeof topK === "number" && Number.isFinite(topK)
    ? Math.trunc(topK)
    : retrieval.researchSourceBudget;
  const boundedTopK = Math.max(8, Math.min(requestedTopK, retrieval.researchSourceBudget));
  const [structuredMatches, vectorMatches, devotionalMatches, inventoryMatches] = await Promise.all([
    getStructuredResearchSources(question, boundedTopK),
    getEpisodeRagSources(question, { topK: boundedTopK }),
    getPastorWoodPostRagSources(question, { topK: Math.min(boundedTopK, 24) }),
    isInterviewInventoryQuestion(question)
      ? getInterviewInventorySources(retrieval.researchInterviewInventoryLimit)
      : Promise.resolve([]),
  ]);

  const vectorSources = vectorMatches.map((source) => ({
    citationId: "",
    lane: source.sourceType.startsWith("intelligence.") ? "semantic intelligence" : "semantic transcript",
    sourceType: source.sourceType,
    trackId: source.trackId,
    title: source.title,
    publishDate: source.publishDate,
    segmentId: source.segmentId,
    snippet: source.text,
    text: source.text,
    startTime: source.startTime,
    endTime: source.endTime,
    speakers: source.speakers,
    score: source.score,
    vectorModel: source.vectorModel,
    sourceUrl: source.sourceUrl,
  }));

  const devotionalSources = devotionalMatches.map((source) => ({
    citationId: "",
    lane: "Pastor Wood devotionals",
    sourceType: source.sourceType,
    trackId: source.trackId,
    title: source.title,
    publishDate: source.publishDate,
    segmentId: source.segmentId,
    snippet: source.text,
    text: source.text,
    startTime: source.startTime,
    endTime: source.endTime,
    speakers: source.speakers,
    score: source.score,
    vectorModel: source.vectorModel,
    sourceUrl: source.sourceUrl,
  }));

  const seedEpisodeIds = [...new Set([...structuredMatches, ...inventoryMatches, ...vectorSources].map((source) => source.trackId))]
    .slice(0, retrieval.researchCandidateEpisodes);
  const [summarySources, detailSources] = await Promise.all([
    getEpisodeSummarySources(seedEpisodeIds.slice(0, retrieval.researchSummaryEpisodes)),
    getTranscriptDetailSources(question, seedEpisodeIds, retrieval.researchDetailExcerpts),
  ]);

  const orientationSources = summarySources.map((source) => ({
    citationId: "",
    lane: "episode orientation",
    sourceType: source.sourceType,
    trackId: source.trackId,
    title: source.title,
    publishDate: source.publishDate,
    segmentId: source.segmentId,
    snippet: source.text,
    text: source.text,
    startTime: source.startTime,
    endTime: source.endTime,
    speakers: source.speakers,
    score: source.score,
    vectorModel: source.vectorModel,
    sourceUrl: source.sourceUrl,
  }));

  const combinedSources = dedupeSources([
    ...inventoryMatches.slice(0, retrieval.researchInterviewInventoryLimit),
    ...structuredMatches.slice(0, boundedTopK),
    ...vectorSources.slice(0, boundedTopK),
    ...devotionalSources.slice(0, boundedTopK),
    ...detailSources,
    ...orientationSources,
  ]);

  if (!combinedSources.length) {
    return {
      answer: "I could not find enough indexed corpus material for that question. Try a different phrase, a person name, a Bible passage, or an episode title.",
      query: question,
      provider: selectedProvider ?? "silo",
      model: "",
      sources: [],
      topEpisodeIds: [],
      retrievalLanes: [],
      coverageNote: "No structured, vector, devotional, or detail transcript sources were returned.",
      escalated: false,
      detailEpisodeIds: [],
    };
  }

  const citedSourceLimit = isInterviewInventoryQuestion(question)
    ? retrieval.researchInterviewMaxSources
    : retrieval.researchMaxSources;
  const citedSources = combinedSources
    .slice(0, citedSourceLimit)
    .map((source, index) => ({
      ...source,
      citationId: `S${index + 1}`,
    }));

  const lanes = [
    summarizeLane("structured", "Structured intelligence", "Summaries, topics, interviews, stories, and extracted source-backed items.", [
      ...inventoryMatches,
      ...structuredMatches,
    ]),
    summarizeLane("semantic", "Semantic retrieval", "Vector matches from transcript chunks and intelligence vectors.", vectorSources),
    summarizeLane("pastorwood-devotionals", "Pastor Wood devotionals", "Vector matches from weekly devotional posts scraped from pastorwood.org.", devotionalSources),
    summarizeLane("detail", "Detail transcript search", "Full transcript segment matches with adjacent context from likely episodes.", detailSources),
    summarizeLane("orientation", "Episode summaries", "Episode-level summaries added after candidate episodes were identified.", orientationSources),
  ].filter((lane) => lane.sourceCount > 0);

  const topEpisodeIds = [...new Set(citedSources
    .filter((source) => !source.sourceType.startsWith("pastorwood."))
    .map((source) => source.trackId))];
  const pastorWoodPostIds = [...new Set(citedSources
    .filter((source) => source.sourceType.startsWith("pastorwood."))
    .map((source) => source.trackId))];
  const coverageNote = [
    `Retrieved ${citedSources.length} source excerpts from ${topEpisodeIds.length} episodes and ${pastorWoodPostIds.length} Pastor Wood posts.`,
    inventoryMatches.length ? `Structured interview inventory returned ${inventoryMatches.length} candidate item${inventoryMatches.length === 1 ? "" : "s"}.` : "",
    devotionalSources.length ? `Weekly devotional retrieval returned ${devotionalSources.length} candidate excerpt${devotionalSources.length === 1 ? "" : "s"}.` : "",
    detailSources.length ? "Escalated into transcript detail search for likely episodes." : "No exact transcript detail escalation matches were found for this wording.",
  ]
    .filter(Boolean)
    .join(" ");

  const messages = [
    {
      role: "system",
      content: buildResearchSystemPrompt(),
    },
    {
      role: "user",
      content: buildResearchPrompt(question, citedSources, lanes, coverageNote),
    },
  ];

  const chatResult = await callChatModel(messages, selectedProvider);

  return {
    answer: chatResult.text || "The model returned no answer text. Try rephrasing the question.",
    query: question,
    provider: chatResult.provider,
    model: chatResult.model,
    sources: citedSources,
    topEpisodeIds,
    retrievalLanes: lanes,
    coverageNote,
    escalated: detailSources.length > 0,
    detailEpisodeIds: [...new Set(detailSources.map((source) => source.trackId))],
    usage: chatResult.usage,
    usageJson: chatResult.usageJson,
  };
}
