import Link from "next/link";

import { TopRail } from "@/components/top-rail";
import { RoutePanel } from "@/components/route-panel";
import { RagChatWidget } from "@/components/rag-chat-widget";
import { getEpisodeDetail } from "@/lib/podcast-data";

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
}: {
  params: Promise<{ trackId: string }>;
}) {
  const { trackId } = await params;
  const detail = await getEpisodeDetail(trackId);

  if (!detail) {
    return (
      <>
        <TopRail variant="public" />
        <main className="public-shell">
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

  const groupedByType = new Map<string, typeof detail.intelligenceItems>();
  for (const item of detail.intelligenceItems) {
    const key = item.itemType || "other";
    const existing = groupedByType.get(key) ?? [];
    existing.push(item);
    groupedByType.set(key, existing);
  }

  return (
    <>
      <TopRail variant="public" />
      <main className="public-shell">
        <RoutePanel
          eyebrow="Episode detail"
          title={detail.episode.title}
          aside={
            <div className="compact-actions">
              <Link className="button button--ghost" href="/episodes">
                Back to episodes
              </Link>
              {detail.episode.audioUrl ? (
                <>
                  <a className="button button--primary" href={detail.episode.audioUrl} target="_blank" rel="noopener noreferrer">
                    Open audio file
                  </a>
                  <audio className="detail-audio" controls preload="none" src={detail.episode.audioUrl}>
                    <track kind="captions" />
                    Your browser does not support audio playback.
                  </audio>
                </>
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
              <h3>Search-ready context</h3>
              <p className="note">
                This view supports RAG chat and retrieval over this episode’s transcript and intelligence chunks.
              </p>
              <RagChatWidget
                action={`/api/episodes/${detail.episode.trackId}/chat`}
                defaultQuestion=""
                heading="Ask this sermon"
                description="Ask questions that should be answered from this episode only."
                submitLabel="Ask episode"
                sourceLabel="Episode sources"
                compactMode
              />
            </div>
          </section>

          {detail.intelligence ? (
            <section className="detail-section">
              <h3>Episode intelligence</h3>
              <p>
                <strong>Type:</strong> {detail.intelligence.episodeType || "episode"}
              </p>
              <div className="summary-block">
                <p>
                  <strong>Generated executive summary</strong>
                </p>
                <p>{detail.intelligence.executiveSummary || "No executive summary available."}</p>
              </div>
              <div className="summary-block">
                <strong>Generated long summary</strong>
                <p>{detail.intelligence.longSummary || "No long summary available."}</p>
              </div>
            </section>
          ) : (
            <section className="detail-section">
              <h3>Episode intelligence</h3>
              <p className="note">No intelligence summary row has been generated yet.</p>
            </section>
          )}

          {detail.intelligenceItems.length > 0 ? (
            <section className="detail-section">
              <h3>Structured intelligence</h3>
              <div className="intelligence-groups">
                {[...groupedByType.entries()].map(([type, rows]) => (
                  <details key={type} className="intelligence-group" open>
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
            </section>
          ) : null}

          <section className="detail-section">
            <h3>Transcript</h3>
            {detail.transcript.length === 0 ? (
              <p className="empty-state">No indexed transcript chunks for this episode.</p>
            ) : (
              <div className="transcript-list">
                {detail.transcript.map((segment) => (
                  <article key={segment.customId} className="transcript-segment">
                    <div className="transcript-segment-meta">
                      <strong>{segment.segmentType || "transcript"}</strong>
                      <span>{segment.startTime && segment.endTime ? `${segment.startTime}–${segment.endTime}` : "timing unavailable"}</span>
                    </div>
                    <p className="note">
                      {segment.speakers.length ? `Speakers: ${segment.speakers.join(", ")}` : ""}
                    </p>
                    <p>{segment.text || "—"}</p>
                  </article>
                ))}
              </div>
            )}
          </section>

        </RoutePanel>
      </main>
    </>
  );
}
