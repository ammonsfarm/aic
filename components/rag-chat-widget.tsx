"use client";

import { FormEvent, useState } from "react";

type ChatSource = {
  citationId?: string;
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

type ChatResponse = {
  answer: string;
  query: string;
  provider: string;
  model: string;
  sources: ChatSource[];
  topEpisodeIds: string[];
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
};

function speakerText(speakers: string[]) {
  if (!speakers.length) {
    return "";
  }

  return ` • ${speakers.join(", ")}`;
}

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
}: RagChatWidgetProps) {
  const [question, setQuestion] = useState(defaultQuestion);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<ChatSource[]>([]);
  const [providerLabel, setProviderLabel] = useState("");
  const [modelLabel, setModelLabel] = useState("");

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

    try {
      const response = await fetch(action, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question: trimmedQuestion, topK: 12 }),
      });

      const body = (await response.json().catch(() => ({}))) as ChatResponse & { error?: string };
      if (!response.ok) {
        setErrorMessage(body?.error ?? `Request failed (${response.status})`);
        return;
      }

      setAnswer(body.answer);
      setSources(body.sources ?? []);
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

      <form onSubmit={onSubmit} className="chat-form">
        <label htmlFor={`${action}-question`} className="sr-only">
          Ask a question
        </label>
        <textarea
          id={`${action}-question`}
          className="chat-textarea"
          rows={compactMode ? 3 : 4}
          placeholder="Ask a question about this content"
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
          <div className="chat-answer__content">{answer}</div>
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
                    [{source.citationId ?? `S${index + 1}`}] {source.title} · {source.sourceType} · {sourceTimeLabel(source)}
                  </summary>
                  <div>
                    <p className="chat-source__meta">
                      Track {source.trackId} · {source.publishDate}
                      {speakerText(source.speakers)}
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
