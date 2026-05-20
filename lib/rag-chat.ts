import { getEpisodeRagSources, getEpisodeSummarySources, type EpisodeChatSource } from "@/lib/podcast-data";

type RagProvider = "silo" | "openai";

type RagChatSource = {
  citationId: string;
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
};

type RagChatResponse = {
  answer: string;
  query: string;
  provider: string;
  model: string;
  sources: RagChatSource[];
  topEpisodeIds: string[];
};

function clampProvider(value: string | undefined): RagProvider {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "silo" || normalized === "openai") {
    return normalized;
  }

  return "silo";
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatSourceContext(sources: EpisodeChatSource[]) {
  return sources
    .map((source, index) => {
      const label = `S${index + 1}`;
      const when = source.startTime || source.endTime ? ` (${source.startTime || "?"}-${source.endTime || "?"})` : "";
      const speaker = source.speakers?.length ? ` • speakers: ${source.speakers.join(", ")}` : "";
      return `[${label}] ${source.title}${when}${speaker}\n` +
        `Track ${source.trackId} (${source.vectorModel || "embedding"}) ${source.sourceType}\n${truncateText(source.text, 850)}`;
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

async function callSiloEndpoint(messages: Array<{ role: string; content: string }>, model: string) {
  const url = process.env.SILO_CHAT_URL ?? "http://192.168.1.195:4041/v1/chat/completions";
  const token = process.env.SILO_TEMP_KEY;

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
      reasoning: { effort: "medium" },
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

async function callOpenAiEndpoint(messages: Array<{ role: string; content: string }>, model: string) {
  const token = process.env.OPENAI_API_KEY;
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

async function callChatModel(messages: Array<{ role: string; content: string }>, provider: RagProvider): Promise<{ text: string; model: string }> {
  const defaultModel = process.env.OPENAI_RAG_MODEL || "openai-codex/gpt-5.3-codex-spark";

  if (provider === "openai") {
    const model = process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini";
    const output = await callOpenAiEndpoint(messages, model);
    return { text: await extractChatText(output), model };
  }

  try {
    const output = await callSiloEndpoint(messages, defaultModel);
    const text = await extractChatText(output);
    return { text, model: defaultModel };
  } catch (error) {
    if (error instanceof Error && process.env.OPENAI_API_KEY) {
      const fallbackModel = process.env.OPENAI_CHAT_MODEL || defaultModel.replace("openai-codex/", "");
      const output = await callOpenAiEndpoint(messages, fallbackModel);
      return { text: await extractChatText(output), model: fallbackModel };
    }

    throw error;
  }
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

export async function runRagChat({
  query,
  trackId,
  topK = 10,
  provider,
}: {
  query: string;
  trackId?: string;
  topK?: number;
  provider?: string;
}): Promise<RagChatResponse> {
  const question = query.trim();

  if (!question) {
    return {
      answer: "Ask a clear question about episodes, sermons, people, or scripture references.",
      query: "",
      provider: provider ?? "silo",
      model: "",
      sources: [],
      topEpisodeIds: [],
    };
  }

  const sources = await getEpisodeRagSources(question, { trackId, topK: Math.max(1, Math.min(topK, 40)) });
  if (!sources.length) {
    return {
      answer: "I could not find enough indexed sermon content to answer that question. Try a shorter phrasing or include a clearer topic reference.",
      query: question,
      provider: provider ?? "silo",
      model: "",
      sources: [],
      topEpisodeIds: [],
    };
  }

  const episodeIdsForSummaries = [...new Set(sources.map((source) => source.trackId))].slice(0, 4);
  const summarySources = await getEpisodeSummarySources(episodeIdsForSummaries);
  const combinedSources = [...summarySources, ...sources];

  const limitedSources = combinedSources
    .slice(0, Math.max(1, Math.min(topK + 4, 16)))
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

  const selectedProvider = clampProvider(provider);
  const chatResult = await callChatModel(messages, selectedProvider);

  const text = chatResult.text || "The model returned no answer text. Try rephrasing the question.";
  const uniqueEpisodeIds = [...new Set(limitedSources.map((row) => row.trackId))];

  return {
    answer: text,
    query: question,
    provider: selectedProvider,
    model: chatResult.model,
    sources: limitedSources,
    topEpisodeIds: uniqueEpisodeIds,
  };
}
