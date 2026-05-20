"use client";

import { FormEvent, useState } from "react";

type ChatSource = {
  citationId?: string;
  sourceType: string;
  title: string;
  trackId: string;
  publishDate: string;
  snippet: string;
  segmentId: string;
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
};

type ComposePrompt = {
  label: string;
  prompt: string;
};

const PROMPTS: ComposePrompt[] = [
  {
    label: "25 minute sermon from passage",
    prompt:
      "Create a 25 minute sermon based on James Chapter 2 with Pastor Jim Wood style, practical illustrations, and sermon structure.",
  },
  {
    label: "Pastor-tuned Bible study plan",
    prompt:
      "Create a 14 day Bible study plan focused on practical obedience using James, written in a warm instructional tone.",
  },
  {
    label: "Guest interview article",
    prompt:
      "Write a 700-word article based on interviews featured in this archive about pastoral wisdom and life application.",
  },
  {
    label: "Testimony style devotional",
    prompt: "Draft a short devotional centered on James 1 with clear life application and a real-life story cadence.",
  },
];

function sourceLabel(source: ChatSource) {
  const time = source.startTime && source.endTime ? `${source.startTime}–${source.endTime}` : "transcript context";
  const people = source.speakers.length ? ` (${source.speakers.join(", ")})` : "";
  return `${source.sourceType}: ${source.title} · ${time}${people}`;
}

export function ComposeWorkbench() {
  const [question, setQuestion] = useState("");
  const [provider, setProvider] = useState("silo");
  const [topK, setTopK] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<ChatSource[]>([]);
  const [usage, setUsage] = useState("" );

  const onPickTemplate = (prompt: string) => {
    setQuestion(prompt);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = question.trim();
    if (!prompt || loading) {
      return;
    }

    setLoading(true);
    setError("");
    setAnswer("");
    setSources([]);
    setUsage("");

    try {
      const response = await fetch("/api/rag/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: prompt, topK, provider }),
      });

      const payload = (await response.json().catch(() => ({}))) as ChatResponse & { error?: string };
      if (!response.ok) {
        setError(payload?.error ?? `Request failed (${response.status})`);
        return;
      }

      setAnswer(payload.answer || "The model returned no text.");
      setSources(payload.sources ?? []);
      setUsage(payload.provider ? `${payload.provider}${payload.model ? ` / ${payload.model}` : ""}` : "");
      setQuestion("");
    } catch {
      setError("Could not reach compose endpoint.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="compose-workbench">
      <div className="compose-grid">
        {PROMPTS.map((item) => (
          <button
            type="button"
            key={item.label}
            className="workflow-button"
            onClick={() => onPickTemplate(item.prompt)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <form className="compose-form" onSubmit={onSubmit}>
        <label htmlFor="compose-provider" className="sr-only">Provider</label>
        <select
          id="compose-provider"
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
          disabled={loading}
        >
          <option value="silo">silo_ai_svc (preferred)</option>
          <option value="openai">direct OpenAI fallback</option>
        </select>

        <label htmlFor="compose-topk" className="sr-only">Top K</label>
        <input
          id="compose-topk"
          type="number"
          min={6}
          max={40}
          value={topK}
          onChange={(event) => setTopK(Math.max(6, Math.min(40, Number(event.target.value) || 10)))}
          disabled={loading}
        />

        <label htmlFor="compose-question" className="sr-only">Draft prompt</label>
        <textarea
          id="compose-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={6}
          placeholder="Write a source-backed sermon, sermon plan, or devotional request"
          disabled={loading}
        />

        <button className="button button--primary" type="submit" disabled={loading || !question.trim()}>
          {loading ? "Composing…" : "Generate draft"}
        </button>
      </form>

      {error ? <p className="empty-state empty-state--error">{error}</p> : null}

      {answer ? (
        <article className="chat-answer">
          <p className="eyebrow">AI draft</p>
          <div className="chat-answer__content">{answer}</div>
          {usage ? <p className="note">Generated by {usage}</p> : null}

          {sources.length > 0 ? (
            <div className="chat-sources">
              <p className="chat-sources__title">Source excerpts used</p>
              {sources.map((source, index) => (
                <details key={`${source.trackId}-${source.segmentId}-${index}`} className="chat-source">
                  <summary>[{source.citationId ?? `S${index + 1}`}] {sourceLabel(source)}</summary>
                  <div>
                    <p className="chat-source__meta">Track {source.trackId} · {source.publishDate}</p>
                    <p>{source.snippet}</p>
                  </div>
                </details>
              ))}
            </div>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
