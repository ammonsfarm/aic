"use client";

import { FormEvent, useState } from "react";

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
  topK = 12,
  starterQuestions = [],
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
  const fieldId = `${action.replace(/[^a-z0-9]+/gi, "-")}-question`;

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

    try {
      const response = await fetch(action, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question: trimmedQuestion, topK }),
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
      setQuestion("");
    } catch {
      setErrorMessage("Unable to reach the chat endpoint. Check service health and retry.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className={`chat-widget ${compactMode ? "chat-widget--compact" : ""}`}>
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
    </section>
  );
}
