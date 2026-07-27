import Link from "next/link";

import { TopRail } from "@/components/top-rail";
import { RoutePanel } from "@/components/route-panel";
import { RagChatWidget } from "@/components/rag-chat-widget";
import { TranscriptReader } from "@/components/transcript-reader";
import { requireInternalReadConsoleUser } from "@/lib/console-access";
import { getEpisodeDetail } from "@/lib/podcast-data";
import { canGenerateForRole, canMutateForRole } from "@/lib/rbac";
import {
  getEpisodeReprocessContextByTrackId,
  type EpisodeReprocessContext,
} from "@/lib/strapi-structured-management";
import { queueEpisodeReprocessAction } from "@/app/podcast/episodes/actions";

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

export default async function EpisodeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ trackId: string }>;
  searchParams: Promise<{
    reprocessQueued?: string;
    reprocessError?: string;
  }>;
}) {
  const [{ trackId }, pageParams] = await Promise.all([params, searchParams]);
  const appUser = await requireInternalReadConsoleUser();
  const detail = await getEpisodeDetail(trackId);

  if (!detail) {
    return (
      <>
        <TopRail variant="private" role={appUser.role} />
        <main className="public-shell" id="main-content" tabIndex={-1}>
          <RoutePanel
            eyebrow="Episode not found"
            title="Episode not found"
            aside={<p className="note">Check the episode identifier and try again from the archive.</p>}
          >
            <p className="empty-state">
              No episode row exists for track <strong>{trackId}</strong>.
            </p>
            <Link className="button button--ghost" href="/episodes">
              Back to episodes
            </Link>
          </RoutePanel>
        </main>
      </>
    );
  }

  const isAdministrator = appUser.role === "Admin";
  let reprocessContext: EpisodeReprocessContext | null = null;
  let reprocessLookupError = "";
  if (isAdministrator) {
    try {
      reprocessContext = await getEpisodeReprocessContextByTrackId(trackId);
    } catch (cause) {
      console.error("Episode reprocess status lookup failed", cause);
      reprocessLookupError = "The Strapi processing queue is temporarily unavailable.";
    }
  }
  const episodeHref = `/episodes/${encodeURIComponent(detail.episode.trackId)}`;

  const groupedByType = new Map<string, typeof detail.intelligenceItems>();
  for (const item of detail.intelligenceItems) {
    const key = item.itemType || "other";
    const existing = groupedByType.get(key) ?? [];
    existing.push(item);
    groupedByType.set(key, existing);
  }

  return (
    <>
      <TopRail variant="private" role={appUser.role} />
      <main className="public-shell" id="main-content" tabIndex={-1}>
        <RoutePanel
          eyebrow="Episode detail"
          title={detail.episode.title}
          actions={
            <div className="compact-actions">
              <Link className="button button--ghost" href="/episodes">
                Back to episodes
              </Link>
              {detail.episode.sourceUrl || detail.episode.audioUrl ? (
                <a
                  className="button button--primary"
                  href={detail.episode.sourceUrl || detail.episode.audioUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open source audio
                </a>
              ) : null}
            </div>
          }
        >
          <section className="detail-grid">
            <div>
              <h3>Episode metadata</h3>
              <div className="meta-list">
                <p>
                  <strong>Track</strong> {detail.episode.trackId}
                </p>
                <p>
                  <strong>Date</strong> {formatDate(detail.episode.publishDate)}
                </p>
                <p>
                  <strong>Album</strong> {detail.episode.album || "—"}
                </p>
                <p>
                  <strong>Category</strong> {detail.episode.category || "—"}
                </p>
              </div>
              {detail.episode.detail ? <p className="note">“{detail.episode.detail}”</p> : null}

              <div className="status-pills status-pills--compact">
                <span>{detail.episode.audioUrl ? "Audio available" : "No audio link"}</span>
                <span>{detail.episode.hasTranscript ? "Transcript available" : "No transcript"}</span>
              </div>
            </div>

            <div>
              {canGenerateForRole(appUser.role) ? (
                <RagChatWidget
                  action={`/api/episodes/${detail.episode.trackId}/chat`}
                  defaultQuestion=""
                  heading="Research"
                  description="Ask questions that should be answered from this episode only."
                  submitLabel="Ask episode"
                  sourceLabel="Episode sources"
                  compactMode
                  historyScope="episode"
                  historyTrackId={detail.episode.trackId}
                />
              ) : (
                <p className="empty-state" role="status">
                  Episode questions are not available for your role. The episode record and transcript remain available below.
                </p>
              )}
            </div>
          </section>

          {detail.intelligence ? (
            <section className="detail-section">
              <h3>Episode Summary</h3>
              <div className="summary-block">
                <p>
                  <strong>About this Episode</strong>
                </p>
                <p>{detail.intelligence.executiveSummary || "No executive summary available."}</p>
              </div>
              <div className="summary-block">
                <strong>Detailed Summary</strong>
                <p>{detail.intelligence.longSummary || "No long summary available."}</p>
              </div>
            </section>
          ) : (
            <section className="detail-section">
              <h3>Episode Summary</h3>
              <p className="note">No intelligence summary row has been generated yet.</p>
            </section>
          )}

          <section className="detail-section">
            <h3>Audio Player</h3>
            <TranscriptReader
              audioUrl={detail.episode.audioUrl}
              canEditTranscript={canMutateForRole(appUser.role)}
              segments={detail.transcript}
              trackId={detail.episode.trackId}
            />
          </section>

          {isAdministrator ? (
            <section className="detail-section" id="episode-reprocess">
              <p className="eyebrow">Administrator action</p>
              <h3>Reprocess this episode</h3>
              {pageParams.reprocessQueued === "1" ? (
                <div className="notice-card notice-card--success" role="status">
                  <strong>Full reprocessing queued</strong>
                  <p>The background worker will rebuild the transcript, vectors, intelligence, and database records.</p>
                </div>
              ) : null}
              {pageParams.reprocessError ? (
                <p className="empty-state empty-state--error" role="alert">{pageParams.reprocessError}</p>
              ) : null}
              {reprocessLookupError ? (
                <p className="empty-state empty-state--error" role="alert">{reprocessLookupError}</p>
              ) : !reprocessContext ? (
                <p className="empty-state" role="status">
                  No matching Strapi episode exists for Track ID {detail.episode.trackId}; reprocessing cannot be queued here.
                </p>
              ) : reprocessContext.processing?.status === "queued" || reprocessContext.processing?.status === "running" ? (
                <p className="notice-card" role="status">
                  Episode processing is already {reprocessContext.processing.status}. A second request cannot be queued.
                </p>
              ) : (
                <form
                  className="editor-grid editor-grid--two"
                  action={queueEpisodeReprocessAction.bind(null, detail.episode.trackId, episodeHref)}
                >
                  <p className="muted-copy">
                    This queues a destructive rebuild of transcript-derived data. The worker retranscribes the canonical MinIO
                    audio, recreates transcript and intelligence vectors, and reloads the episode data in PostgreSQL.
                  </p>
                  <label>
                    <span>Reason for reprocessing</span>
                    <input
                      name="reprocessNote"
                      required
                      maxLength={2000}
                      placeholder="For example: transcript quality correction"
                    />
                  </label>
                  <label className="checkbox-row checkbox-row--form">
                    <input name="confirmReprocess" type="checkbox" value="confirmed" required />
                    <span>I understand this replaces the current transcript-derived data.</span>
                  </label>
                  <div className="editor-form__actions">
                    <button className="button" type="submit">Reprocess episode</button>
                  </div>
                </form>
              )}
            </section>
          ) : null}

          {detail.intelligenceItems.length > 0 ? (
            <details className="detail-section detail-section--collapsible">
              <summary>Structured intelligence</summary>
              <div className="intelligence-groups">
                {[...groupedByType.entries()].map(([type, rows]) => (
                  <details key={type} className="intelligence-group">
                    <summary>
                      {type} ({rows.length})
                    </summary>
                    {rows.map((row) => (
                      <article key={row.id} className="intelligence-item">
                        <p>
                          <strong>{row.label}</strong>
                        </p>
                        <p>{row.summary}</p>
                        {row.speakers?.length ? (
                          <p className="note">Speaker(s): {row.speakers.join(", ")}</p>
                        ) : null}
                      </article>
                    ))}
                  </details>
                ))}
              </div>
            </details>
          ) : null}

        </RoutePanel>
      </main>
    </>
  );
}
