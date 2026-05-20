"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import type { EpisodeSearchScope } from "@/lib/podcast-data";

type SearchMode = "hybrid" | "text";

type EpisodeRow = {
  trackId: string;
  title: string;
  publishDate: string | null;
  album: string;
  category: string;
  detail: string;
  sourceFile?: string;
  hasTranscript?: boolean;
  hasIntelligence?: boolean;
  hasVectors?: boolean;
  hasPodtrac?: boolean;
  score: number;
  hitTypes: string[];
  snippet: string;
};

type SearchApiResponse = {
  query: string;
  results: EpisodeRow[];
  total: number;
  mode: SearchMode;
};

type EpisodeSearchProps = {
  endpoint?: string;
  detailBasePath?: string;
  defaultQuery?: string;
  defaultMode?: SearchMode;
  defaultTopK?: number;
  defaultScope?: EpisodeSearchScope;
  trackId?: string;
  includeTrackFilter?: boolean;
  showInternalStatus?: boolean;
  initialRows?: EpisodeRow[];
  initialTotal?: number;
};

const QUICK_QUERIES = [
  "James chapter two",
  "interview with",
  "pastor wood childhood",
  "faith and works",
];

function formatDate(value: string | null) {
  if (!value) {
    return "No date";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function statusLabel(value: boolean, yesLabel: string, noLabel: string) {
  return value ? yesLabel : noLabel;
}

function joinHitTypes(hitTypes: string[]) {
  return hitTypes
    .filter(Boolean)
    .map((type) => type.replace(/^.*\./, ""))
    .filter(Boolean)
    .slice(0, 3);
}

async function searchEpisodes(payload: {
  endpoint: string;
  q: string;
  mode: SearchMode;
  topK: number;
  trackId?: string;
  scope: EpisodeSearchScope;
  includeInternal?: boolean;
}): Promise<SearchApiResponse> {
  const params = new URLSearchParams({
    q: payload.q,
    mode: payload.mode,
    top_k: String(payload.topK),
    text_only: payload.mode === "text" ? "true" : "false",
    scope: payload.scope,
  });

  if (payload.includeInternal) {
    params.set("include_internal", "true");
  }

  if (payload.trackId) {
    params.set("track_id", payload.trackId);
  }

  const response = await fetch(`${payload.endpoint}?${params.toString()}`, { cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as SearchApiResponse & { error?: string };

  if (!response.ok) {
    throw new Error(body.error ?? `Search request failed (${response.status})`);
  }

  return body;
}

export function EpisodeSearchPanel({
  endpoint = "/api/episodes/search",
  detailBasePath = "/episodes",
  defaultQuery = "",
  defaultMode = "hybrid",
  defaultTopK = 20,
  defaultScope = "all",
  trackId,
  includeTrackFilter = false,
  showInternalStatus = false,
  initialRows = [],
  initialTotal,
}: EpisodeSearchProps) {
  const topOptions = [10, 20, 40, 60];
  const [mode, setMode] = useState<SearchMode>(defaultMode);
  const [query, setQuery] = useState(defaultQuery);
  const [scope, setScope] = useState<EpisodeSearchScope>(defaultScope);
  const [topK, setTopK] = useState(defaultTopK);
  const [results, setResults] = useState<EpisodeRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal ?? initialRows.length);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Search starts from index data.");
  const [error, setError] = useState("");

  const endpointHint = useMemo(() => {
    if (endpoint.includes("/episodes")) {
      return "episode archive";
    }

    return "search";
  }, [endpoint]);

  const runSearch = async (payload: {
    query: string;
    mode: SearchMode;
    topK: number;
    trackId?: string;
    scope: EpisodeSearchScope;
  }) => {
    if (!payload.query.trim()) {
      setError("");
      setStatusMessage("Enter a search phrase or browse using recent rows.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await searchEpisodes({
        endpoint,
        q: payload.query,
        mode: payload.mode,
        topK: payload.topK,
        trackId: payload.trackId,
        scope: payload.scope,
        includeInternal: showInternalStatus,
      });
      setResults(response.results);
      setTotal(response.total);
      setStatusMessage(`${response.mode.toUpperCase()} search returned ${response.total} episode row(s).`);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Search request failed.");
      setResults([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runSearch({ query, mode, topK, trackId, scope });
  };

  const onQuickSearch = (value: string) => {
    setQuery(value);
    void runSearch({ query: value, mode, topK, trackId, scope });
  };

  return (
    <section className="search-shell">
      <form className="episode-toolbar" onSubmit={onSubmit}>
        <label htmlFor="episode-search-query" className="sr-only">
          Search episodes
        </label>
        <input
          id="episode-search-query"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by title, scripture, guest name, sermon theme, story, or question"
        />

        <label htmlFor="episode-search-mode" className="sr-only">
          Search mode
        </label>
        <select
          id="episode-search-mode"
          value={mode}
          onChange={(event) => setMode(event.target.value as SearchMode)}
        >
          <option value="hybrid">Hybrid text + vector</option>
          <option value="text">Text only</option>
        </select>

        <label htmlFor="episode-search-scope" className="sr-only">
          Search scope
        </label>
        <select
          id="episode-search-scope"
          value={scope}
          onChange={(event) => setScope(event.target.value as EpisodeSearchScope)}
        >
          <option value="all">All content</option>
          <option value="title">Title and metadata</option>
          <option value="passage">Bible passage</option>
          <option value="guest">Guest or person</option>
          <option value="interview">Interview</option>
          <option value="theme">Theme, story, or illustration</option>
        </select>

        <label htmlFor="episode-search-topk" className="sr-only">
          Max results
        </label>
        <select
          id="episode-search-topk"
          value={String(topK)}
          onChange={(event) => setTopK(Number(event.target.value))}
        >
          {topOptions.map((value) => (
            <option key={value} value={value}>
              {value} result{value === 1 ? "" : "s"}
            </option>
          ))}
        </select>

        {includeTrackFilter && trackId ? (
          <span className="scope-pill">
            Episode scope: {trackId}
          </span>
        ) : null}

        <button className="button button--primary" type="submit" disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      <div className="search-quickies" role="group" aria-label="Quick episode queries">
        {QUICK_QUERIES.map((item) => (
          <button
            key={item}
            className="quick-chip"
            type="button"
            onClick={() => onQuickSearch(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="status-band">
        <p className="note">
          {showInternalStatus
            ? `Searching ${endpointHint} via title/metadata/text/intelligence vectors.`
            : `Searching ${endpointHint} by title, scripture, guests, topics, and transcript context.`}{" "}
          {statusMessage}
        </p>
      </div>

      {error ? <p className="empty-state empty-state--error">{error}</p> : null}

      {loading ? <p className="empty-state">Searching corpus for episode matches…</p> : null}

      {!loading && results.length === 0 ? (
        <p className="empty-state">
          {query ? "No matches yet. Try shorter phrasing or switch to text mode." : "Enter a query to search the archive."}
          {total ? ` (${total})` : ""}
        </p>
      ) : null}

      {results.length > 0 ? (
        <section className="episode-result-grid" aria-live="polite">
          {results.map((episode) => (
            <article key={episode.trackId} className="episode-result-card">
              <div className="episode-result-main">
                <p className="eyebrow">{formatDate(episode.publishDate || "")}</p>
                <h3>{episode.title}</h3>
                <p className="note">{episode.album || episode.category || "Episode archive entry"}</p>
                {episode.snippet ? <p className="episode-snippet">“{episode.snippet}”</p> : null}
              </div>
              <div className="episode-result-meta">
                {showInternalStatus ? (
                  <div className="status-pills">
                    <span>{statusLabel(Boolean(episode.hasTranscript), "Transcript", "No transcript")}</span>
                    <span>{statusLabel(Boolean(episode.hasIntelligence), "Intelligence", "No intelligence")}</span>
                    <span>{statusLabel(Boolean(episode.hasVectors), "Vectors", "No vectors")}</span>
                    <span>{statusLabel(Boolean(episode.hasPodtrac), "Podtrac linked", "No podtrac")}</span>
                  </div>
                ) : null}
                {episode.hitTypes.length ? (
                  <p className="note">
                    Matches: {joinHitTypes(episode.hitTypes).join(" · ")}
                  </p>
                ) : null}
                <Link className="button button--ghost" href={`${detailBasePath}/${episode.trackId}`}>
                  Open episode
                </Link>
              </div>
            </article>
          ))}
        </section>
      ) : null}
    </section>
  );
}
