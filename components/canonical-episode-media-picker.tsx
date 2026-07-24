"use client";

import { useEffect, useId, useRef, useState } from "react";

import type {
  CanonicalEpisodeMediaItem,
  CanonicalEpisodeMediaPage,
} from "@/lib/canonical-episode-media";

export function CanonicalEpisodeMediaPicker({
  name,
}: {
  name: string;
}) {
  const searchId = useId();
  const selectionRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<CanonicalEpisodeMediaPage | null>(null);
  const [selected, setSelected] = useState<CanonicalEpisodeMediaItem | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const parameters = new URLSearchParams({
      page: String(page),
      pageSize: "20",
    });
    if (search) parameters.set("search", search);
    fetch(`/api/content/canonical-media?${parameters.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Media lookup returned ${response.status}.`);
        return response.json() as Promise<CanonicalEpisodeMediaPage>;
      })
      .then((payload) => {
        setLookupFailed(false);
        setResult(payload);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Canonical episode audio lookup failed", error);
        setResult(null);
        setLookupFailed(true);
      });
    return () => controller.abort();
  }, [page, refresh, search]);

  return (
    <div className="media-editor-card">
      <input ref={selectionRef} type="hidden" name={name} value={selected?.trackId || ""} />
      <div className="media-editor-card__body">
        <div>
          <p className="eyebrow">Canonical audio library</p>
          <strong>{selected?.title || "Choose existing episode audio"}</strong>
          <p className="muted-copy">
            {selected
              ? `Selected track ${selected.trackId}. This references the existing PostgreSQL and MinIO item; it does not copy the MP3 into Strapi.`
              : "Search the existing AIC PostgreSQL episode catalog and MinIO audio inventory."}
          </p>
          {selected ? (
            <div className="button-row">
              <a className="button button--ghost" href={selected.previewUrl} target="_blank" rel="noreferrer">
                Preview audio
              </a>
              <button
                className="button button--ghost"
                type="button"
                onClick={() => {
                  setSelected(null);
                  selectionRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
                }}
              >
                Clear selection
              </button>
            </div>
          ) : null}
        </div>

        <div className="editor-grid editor-grid--two">
          <label htmlFor={searchId}>
            <span>Search by title, date, or track ID</span>
            <input
              id={searchId}
              type="search"
              value={query}
              maxLength={160}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="editor-form__actions">
            <button
              className="button button--ghost"
              type="button"
              onClick={() => {
                setLookupFailed(false);
                setResult(null);
                setPage(1);
                setSearch(query.trim());
                setRefresh((current) => current + 1);
              }}
            >
              Search audio
            </button>
          </div>
        </div>

        <p className="muted-copy" role="status" aria-live="polite">
          {lookupFailed
            ? "Canonical episode audio is temporarily unavailable."
            : result
              ? result.items.length
                ? `${result.pagination.total.toLocaleString()} canonical episode audio files available.`
                : "No canonical episode audio matched this search."
              : "Loading canonical episode audio…"}
        </p>
        {result?.items.length ? (
          <div className="stack">
            {result.items.map((item) => (
              <div className="status-item" key={item.trackId}>
                <div>
                  <strong>{item.title}</strong>
                  <p className="muted-copy">
                    {item.publishDate || "Date unavailable"} · Track {item.trackId} · Canonical PostgreSQL + MinIO
                  </p>
                </div>
                <button
                  className="button button--ghost"
                  type="button"
                  aria-pressed={selected?.trackId === item.trackId}
                  onClick={() => {
                    setSelected(item);
                    selectionRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
                  }}
                >
                  {selected?.trackId === item.trackId ? "Selected" : "Use audio"}
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {result && result.pagination.pageCount > 1 ? (
          <nav className="button-row" aria-label="Canonical audio pages">
            <button
              className="button button--ghost"
              type="button"
              disabled={page <= 1}
              onClick={() => {
                setLookupFailed(false);
                setResult(null);
                setPage((current) => Math.max(1, current - 1));
              }}
            >
              Previous
            </button>
            <span>Page {page} of {result.pagination.pageCount}</span>
            <button
              className="button button--ghost"
              type="button"
              disabled={page >= result.pagination.pageCount}
              onClick={() => {
                setLookupFailed(false);
                setResult(null);
                setPage((current) => current + 1);
              }}
            >
              Next
            </button>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
