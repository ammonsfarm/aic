"use client";

import { FormEvent, useState } from "react";

import type { MatchedPodtracEpisode, RetryablePipelineStage, UnmatchedPodtracEpisode } from "@/lib/admin-operations";

const retryOptions: Array<{ stage: RetryablePipelineStage; label: string; help: string }> = [
  { stage: "daily-ingest", label: "Daily ingest", help: "Run the complete RSS, audio, transcript and intelligence lane." },
  { stage: "podtrac-import", label: "Podtrac import", help: "Run the fixed Podtrac importer; valid external authentication is still required." },
  { stage: "transcript-edits", label: "Transcript edits", help: "Process pending transcript corrections and revectorization handoff." },
];

type PipelineOperationsProps = {
  isAdministrator: boolean;
  unmatched: UnmatchedPodtracEpisode[];
  matched: MatchedPodtracEpisode[];
};

export function PipelineOperations({ isAdministrator, unmatched, matched }: PipelineOperationsProps) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function post(path: string, body: Record<string, unknown>) {
    setMessage("");
    setError("");
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || `Request failed (${response.status}).`);
    }
  }

  async function queueRetry(event: FormEvent<HTMLFormElement>, stage: RetryablePipelineStage) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(`retry:${stage}`);
    try {
      await post("/api/admin/pipeline/retry", {
        stage,
        sourceRunId: form.get("sourceRunId"),
        reason: form.get("reason"),
      });
      setMessage(`${stage} was queued for the background worker.`);
      event.currentTarget.reset();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not queue the retry.");
    } finally {
      setBusy("");
    }
  }

  async function reconcile(event: FormEvent<HTMLFormElement>, podtracEpisodeId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const trackId = String(form.get("trackId") || "");
    if (!trackId) {
      setError("Choose an archive episode before saving the match.");
      return;
    }
    setBusy(`reconcile:${podtracEpisodeId}`);
    try {
      await post("/api/admin/pipeline/reconcile", {
        podtracEpisodeId,
        trackId,
        note: form.get("note"),
      });
      setMessage("Podtrac match saved with an audit record. Reloading current data…");
      window.location.reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save the match.");
    } finally {
      setBusy("");
    }
  }

  async function unmatch(event: FormEvent<HTMLFormElement>, podtracEpisodeId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const note = String(form.get("note") || "").trim();
    if (!note) {
      setError("Add an audit note explaining why this match should be removed.");
      return;
    }
    setBusy(`unmatch:${podtracEpisodeId}`);
    try {
      await post("/api/admin/pipeline/reconcile", {
        podtracEpisodeId,
        trackId: null,
        note,
      });
      setMessage("Podtrac match removed with an audit record. Reloading current data…");
      window.location.reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not remove the match.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="admin-console">
      <section className="admin-section" id="safe-retries">
        <div className="admin-section__header">
          <div>
            <p className="eyebrow">Safe retry queue</p>
            <h2>Allowlisted background handoff</h2>
          </div>
          <span className="status-item">{isAdministrator ? "Admin controls" : "Read-only"}</span>
        </div>
        <p className="note">
          Web requests only create queue records. A separate worker maps these three stages to fixed argument arrays; no command text is accepted here.
        </p>
        <div className="split-board split-board--wide">
          {retryOptions.map((option) => (
            <form key={option.stage} className="admin-form" onSubmit={(event) => queueRetry(event, option.stage)}>
              <div>
                <h3>{option.label}</h3>
                <p className="note">{option.help}</p>
              </div>
              <label>
                <span>Source run id (optional)</span>
                <input name="sourceRunId" maxLength={120} disabled={!isAdministrator} />
              </label>
              <label>
                <span>Reason</span>
                <input name="reason" maxLength={1000} disabled={!isAdministrator} required={option.stage === "transcript-edits"} placeholder="Why is a retry needed?" />
              </label>
              <button className="button button--primary" type="submit" disabled={!isAdministrator || Boolean(busy)}>
                {busy === `retry:${option.stage}` ? "Queueing…" : `Queue ${option.label}`}
              </button>
            </form>
          ))}
        </div>
      </section>

      <section className="admin-section" id="podtrac-reconciliation">
        <div className="admin-section__header">
          <div>
            <p className="eyebrow">Data quality</p>
            <h2>Unmatched Podtrac reconciliation</h2>
          </div>
          <span className="status-item">{unmatched.length} shown</span>
        </div>
        {unmatched.length === 0 ? <p className="empty-state">No unmatched records match this search.</p> : null}
        <div className="status-list">
          {unmatched.map((episode) => (
            <form
              className="admin-form"
              key={episode.podtracEpisodeId}
              onSubmit={(event) => reconcile(event, episode.podtracEpisodeId)}
            >
              <div>
                <strong>{episode.title}</strong>
                <p className="note">Podtrac {episode.podtracEpisodeId} · {episode.publishDate || "No publication date"}</p>
              </div>
              <label>
                <span>Archive episode candidate</span>
                <select name="trackId" defaultValue="" disabled={!isAdministrator}>
                  <option value="">Choose a match…</option>
                  {episode.candidates.map((candidate) => (
                    <option key={candidate.trackId} value={candidate.trackId}>
                      {candidate.title} · {candidate.publishDate || "No date"} · {Math.round(candidate.score * 100)}% title score
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Audit note</span>
                <input name="note" maxLength={1000} disabled={!isAdministrator} placeholder="Reason for this manual match" />
              </label>
              <button className="button button--primary" type="submit" disabled={!isAdministrator || Boolean(busy)}>
                {busy === `reconcile:${episode.podtracEpisodeId}` ? "Saving…" : "Save match"}
              </button>
            </form>
          ))}
        </div>
      </section>

      <section className="admin-section" id="podtrac-matched-records">
        <div className="admin-section__header">
          <div>
            <p className="eyebrow">Reconciliation review</p>
            <h2>Current Podtrac matches</h2>
          </div>
          <span className="status-item">{matched.length} shown</span>
        </div>
        <p className="note">Use the page search to find a Podtrac id, Podtrac title, archive track id, or archive title. Removing a match returns it to the unmatched queue and writes an audit record.</p>
        {matched.length === 0 ? <p className="empty-state">No matched records match this search.</p> : null}
        <div className="status-list">
          {matched.map((episode) => (
            <form
              className="admin-form"
              key={episode.podtracEpisodeId}
              onSubmit={(event) => unmatch(event, episode.podtracEpisodeId)}
            >
              <div>
                <strong>{episode.title}</strong>
                <p className="note">Podtrac {episode.podtracEpisodeId} · {episode.publishDate || "No publication date"}</p>
                <p className="note">Matched to {episode.episodeTitle} · {episode.trackId} · {episode.episodePublishDate || "No archive date"}</p>
              </div>
              <label>
                <span>Required audit note</span>
                <input name="note" maxLength={1000} required disabled={!isAdministrator} placeholder="Why is this match incorrect?" />
              </label>
              <button className="button button--ghost" type="submit" disabled={!isAdministrator || Boolean(busy)}>
                {busy === `unmatch:${episode.podtracEpisodeId}` ? "Removing…" : "Remove match"}
              </button>
            </form>
          ))}
        </div>
      </section>

      {message ? <p className="empty-state empty-state--success" role="status">{message}</p> : null}
      {error ? <p className="empty-state empty-state--error" role="alert">{error}</p> : null}
    </div>
  );
}
