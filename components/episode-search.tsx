"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import type { EpisodeSearchScope, EpisodeSortOrder } from "@/lib/podcast-data";

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
  defaultDateStart?: string;
  defaultDateEnd?: string;
  defaultSort?: EpisodeSortOrder;
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
    timeZone: "UTC",
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
  dateStart?: string;
  dateEnd?: string;
  sort: EpisodeSortOrder;
  includeInternal?: boolean;
}): Promise<SearchApiResponse> {
  const params = new URLSearchParams({
    q: payload.q,
    mode: payload.mode,
    top_k: String(payload.topK),
    text_only: payload.mode === "text" ? "true" : "false",
    scope: payload.scope,
    sort: payload.sort,
  });

  if (payload.dateStart) {
    params.set("date_start", payload.dateStart);
  }

  if (payload.dateEnd) {
    params.set("date_end", payload.dateEnd);
  }

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
  defaultDateStart = "",
  defaultDateEnd = "",
  defaultSort = "relevance",
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
  const [dateStart, setDateStart] = useState(defaultDateStart);
  const [dateEnd, setDateEnd] = useState(defaultDateEnd);
  const [sort, setSort] = useState<EpisodeSortOrder>(defaultSort);
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
    dateStart?: string;
    dateEnd?: string;
    sort: EpisodeSortOrder;
  }) => {
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
        dateStart: payload.dateStart,
        dateEnd: payload.dateEnd,
        sort: payload.sort,
        includeInternal: showInternalStatus,
      });
      setResults(response.results);
      setTotal(response.total);
      setStatusMessage(
        payload.query.trim()
          ? `${response.mode.toUpperCase()} search returned ${response.total} episode row(s).`
          : `Archive browse returned ${response.total} episode row(s).`,
      );
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
    void runSearch({ query, mode, topK, trackId, scope, dateStart, dateEnd, sort });
  };

  const onQuickSearch = (value: string) => {
    setQuery(value);
    void runSearch({ query: value, mode, topK, trackId, scope, dateStart, dateEnd, sort });
  };

  return (
    <section className="search-shell">
      <form className="episode-toolbar" onSubmit={onSubmit}>
        <label htmlFor="episode-search-query" className="sr-only">
          Search episodes
        </label>
        <div className="episode-toolbar__wide">
          <input
            id="episode-search-query"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title, scripture, guest name, sermon theme, story, or question"
          />
        </div>

        <label htmlFor="episode-search-mode" className="sr-only">
          Search mode
        </label>
        <div className="episode-control episode-control--mode">
          <span className="episode-control__label">Search mode</span>
          <div className="episode-control__row">
            <select
              id="episode-search-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as SearchMode)}
              title="Use text-only mode for exact name or metadata matching, or hybrid for transcript and RAG-aware results."
            >
              <option value="hybrid">Hybrid text + vector</option>
              <option value="text">Text only</option>
            </select>
            <span className="mode-help" tabIndex={0} aria-label="Search mode help">
              ?
              <span className="mode-help__text" role="tooltip">
                Text-only is best for exact names and metadata. Hybrid also uses transcript and RAG-aware matches.
              </span>
            </span>
          </div>
        </div>

        <label htmlFor="episode-search-scope" className="sr-only">
          Search scope
        </label>
        <div className="episode-control">
          <span className="episode-control__label">Search scope</span>
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
        </div>

        <label htmlFor="episode-date-start" className="sr-only">
          From date
        </label>
        <div className="episode-control episode-control--date">
          <span className="episode-control__label">From</span>
          <input
            id="episode-date-start"
            type="date"
            value={dateStart}
            onChange={(event) => setDateStart(event.target.value)}
          />
        </div>

        <label htmlFor="episode-date-end" className="sr-only">
          To date
        </label>
        <div className="episode-control episode-control--date">
          <span className="episode-control__label">To</span>
          <input
            id="episode-date-end"
            type="date"
            value={dateEnd}
            onChange={(event) => setDateEnd(event.target.value)}
          />
        </div>

        <label htmlFor="episode-search-sort" className="sr-only">
          Sort by
        </label>
        <div className="episode-control">
          <span className="episode-control__label">Sort by</span>
          <select
            id="episode-search-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as EpisodeSortOrder)}
          >
            <option value="relevance">Relevance</option>
            <option value="date_desc">Date, newest first</option>
            <option value="date_asc">Date, oldest first</option>
            <option value="title_asc">Title A-Z</option>
          </select>
        </div>

        <label htmlFor="episode-search-topk" className="sr-only">
          Max results
        </label>
        <div className="episode-control">
          <span className="episode-control__label">Results</span>
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
        </div>

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
