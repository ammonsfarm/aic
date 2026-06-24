"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type ChatSource = {
  citationId?: string;
  lane?: string;
  sourceType: string;
  trackId: string;
  title: string;
  publishDate: string;
  segmentId: string;
  snippet: string;
  startTime: string;
  endTime: string;
  speakers: string[];
  score: number;
  vectorModel: string;
};

type RetrievalLane = {
  id: string;
  label: string;
  description: string;
  sourceCount: number;
  episodeCount: number;
};

type ChatResponse = {
  answer: string;
  query: string;
  provider: string;
  model: string;
  sources: ChatSource[];
  topEpisodeIds: string[];
  retrievalLanes?: RetrievalLane[];
  coverageNote?: string;
  escalated?: boolean;
  detailEpisodeIds?: string[];
  interactionId?: string;
  usage?: TokenUsage;
};

type TokenUsage = {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
};

type ChatHistoryItem = {
  id: string;
  scope: "research" | "archive" | "episode";
  trackId: string;
  question: string;
  answer: string;
  provider: string;
  model: string;
  sources: ChatSource[];
  retrievalLanes: RetrievalLane[];
  coverageNote: string;
  usage?: TokenUsage;
  status: "completed" | "failed";
  error: string;
  createdAt: string;
};

type RagChatWidgetProps = {
  action: string;
  defaultQuestion?: string;
  heading: string;
  description?: string;
  submitLabel?: string;
  sourceLabel?: string;
  compactMode?: boolean;
  showDiagnostics?: boolean;
  placeholder?: string;
  topK?: number;
  starterQuestions?: string[];
  historyScope?: ChatHistoryItem["scope"];
  historyTrackId?: string;
};

function sourceTimeLabel(source: ChatSource) {
  if (!source.startTime && !source.endTime) {
    return "transcript context";
  }

  if (!source.endTime) {
    return source.startTime;
  }

  return `${source.startTime}–${source.endTime}`;
}

function formatHistoryDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

export function RagChatWidget({
  action,
  defaultQuestion = "",
  heading,
  description,
  submitLabel = "Ask",
  sourceLabel = "Sources",
  compactMode,
  showDiagnostics = false,
  placeholder = "Ask a question about this content",
  topK,
  starterQuestions = [],
  historyScope,
  historyTrackId,
}: RagChatWidgetProps) {
  const [question, setQuestion] = useState(defaultQuestion);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<ChatSource[]>([]);
  const [retrievalLanes, setRetrievalLanes] = useState<RetrievalLane[]>([]);
  const [coverageNote, setCoverageNote] = useState("");
  const [providerLabel, setProviderLabel] = useState("");
  const [modelLabel, setModelLabel] = useState("");
  const [usage, setUsage] = useState<TokenUsage | null>(null);
  const [activeQuestion, setActiveQuestion] = useState("");
  const [historyItems, setHistoryItems] = useState<ChatHistoryItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const fieldId = `${action.replace(/[^a-z0-9]+/gi, "-")}-question`;

  const loadHistory = useCallback(async () => {
    if (!historyScope) {
      return;
    }

    setIsHistoryLoading(true);
    setHistoryError("");

    const params = new URLSearchParams({ scope: historyScope, limit: "8" });
    if (historyTrackId) {
      params.set("trackId", historyTrackId);
    }

    try {
      const response = await fetch(`/api/rag/history?${params.toString()}`);
      if (response.status === 401 || response.status === 403) {
        setHistoryItems([]);
        return;
      }

      const body = (await response.json().catch(() => ({}))) as { history?: ChatHistoryItem[]; error?: string };
      if (!response.ok) {
        setHistoryError(body.error ?? `History failed (${response.status})`);
        return;
      }

      setHistoryItems(body.history ?? []);
    } catch {
      setHistoryError("Could not load recent questions.");
    } finally {
      setIsHistoryLoading(false);
    }
  }, [historyScope, historyTrackId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadHistory();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadHistory]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || isLoading) {
      return;
    }

    setIsLoading(true);
    setErrorMessage("");
    setAnswer("");
    setSources([]);
    setRetrievalLanes([]);
    setCoverageNote("");
    setUsage(null);
    setActiveQuestion(trimmedQuestion);

    try {
      const response = await fetch(action, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: trimmedQuestion,
          ...(typeof topK === "number" ? { topK } : {}),
        }),
      });

      const body = (await response.json().catch(() => ({}))) as ChatResponse & { error?: string };
      if (!response.ok) {
        setErrorMessage(body?.error ?? `Request failed (${response.status})`);
        return;
      }

      setAnswer(body.answer);
      setSources(body.sources ?? []);
      setRetrievalLanes(body.retrievalLanes ?? []);
      setCoverageNote(body.coverageNote ?? "");
      setProviderLabel(body.provider);
      setModelLabel(body.model);
      setUsage(body.usage ?? null);
      setQuestion("");
      await loadHistory();
    } catch {
      setErrorMessage("Unable to reach the chat endpoint. Check service health and retry.");
    } finally {
      setIsLoading(false);
    }
  };

  const restoreHistoryItem = (item: ChatHistoryItem) => {
    setActiveQuestion(item.question);
    setQuestion(item.question);
    setAnswer(item.answer);
    setSources(item.sources ?? []);
    setRetrievalLanes(item.retrievalLanes ?? []);
    setCoverageNote(item.coverageNote ?? "");
    setProviderLabel(item.provider);
    setModelLabel(item.model);
    setUsage(item.usage ?? null);
    setErrorMessage(item.status === "failed" ? item.error || "This saved interaction failed." : "");
  };

  return (
    <section className={`chat-widget ${compactMode ? "chat-widget--compact" : ""} ${historyScope ? "chat-widget--with-history" : ""}`}>
      <div className="chat-widget__workspace">
        <div className="chat-widget__main">
          <p className="eyebrow">{heading}</p>
          {description ? <p className="chat-widget__desc">{description}</p> : null}
          {starterQuestions.length > 0 ? (
            <div className="chat-starters" aria-label="Suggested research questions">
              {starterQuestions.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  className="chat-starter"
                  onClick={() => setQuestion(starter)}
                  disabled={isLoading}
                >
                  {starter}
                </button>
              ))}
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="chat-form">
            <label htmlFor={fieldId} className="sr-only">
              Ask a question
            </label>
            <textarea
              id={fieldId}
              className="chat-textarea"
              rows={compactMode ? 3 : 4}
              placeholder={placeholder}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              disabled={isLoading}
            />
            <button className="button button--primary" type="submit" disabled={isLoading || !question.trim()}>
              {isLoading ? "Thinking…" : submitLabel}
            </button>
          </form>

          {activeQuestion && answer ? (
            <p className="chat-active-question">
              <strong>Question</strong> {activeQuestion}
            </p>
          ) : null}

          {errorMessage ? <p className="empty-state empty-state--error">{errorMessage}</p> : null}

          {answer ? (
            <article className="chat-answer">
              {retrievalLanes.length > 0 ? (
                <div className="research-lanes" aria-label="Retrieval lanes used">
                  {retrievalLanes.map((lane) => (
                    <div key={lane.id} className="research-lane">
                      <strong>{lane.label}</strong>
                      <span>
                        {lane.sourceCount} source{lane.sourceCount === 1 ? "" : "s"} · {lane.episodeCount} episode
                        {lane.episodeCount === 1 ? "" : "s"}
                      </span>
                      <small>{lane.description}</small>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="chat-answer__content">{answer}</div>
              {coverageNote ? <p className="chat-coverage">{coverageNote}</p> : null}
          {showDiagnostics && (providerLabel || modelLabel) && (
            <p className="note" style={{ marginTop: 8 }}>
              Answered by {providerLabel}
              {modelLabel ? ` / ${modelLabel}` : ""}
              {usage?.total_tokens ? ` · ${usage.total_tokens.toLocaleString()} tokens (${usage.input_tokens.toLocaleString()} in / ${usage.output_tokens.toLocaleString()} out)` : ""}
            </p>
          )}
              {sources.length > 0 && (
                <div className="chat-sources">
                  <p className="chat-sources__title">{sourceLabel}</p>
                  {sources.map((source, index) => (
                    <details key={`${source.trackId}-${source.segmentId}-${index}`} className="chat-source">
                      <summary>
                        [{source.citationId ?? `S${index + 1}`}] {source.title} · {source.lane ?? source.sourceType} · {sourceTimeLabel(source)}
                      </summary>
                      <div>
                        <p className="chat-source__meta">
                          Track {source.trackId} · {source.publishDate} · {source.sourceType}
                        </p>
                        <p>{source.snippet}</p>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </article>
          ) : null}
        </div>

        {historyScope ? (
          <aside className="chat-history" aria-label="Recent questions">
            <div className="chat-history__header">
              <strong>Recent questions</strong>
              <button className="button button--ghost" type="button" onClick={() => void loadHistory()} disabled={isHistoryLoading}>
                {isHistoryLoading ? "Loading..." : "Refresh"}
              </button>
            </div>
            {historyError ? <p className="empty-state empty-state--error">{historyError}</p> : null}
            {!historyError && historyItems.length === 0 ? (
              <p className="note">{isHistoryLoading ? "Loading recent questions." : "No saved questions yet."}</p>
            ) : null}
            <div className="chat-history__list">
              {historyItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`chat-history__item ${item.status === "failed" ? "chat-history__item--failed" : ""}`}
                  onClick={() => restoreHistoryItem(item)}
                >
                  <span>{item.question}</span>
                  <small>
                    {formatHistoryDate(item.createdAt)}
                    {item.status === "failed" ? " · failed" : item.model ? ` · ${item.model}` : ""}
                  </small>
                </button>
              ))}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
