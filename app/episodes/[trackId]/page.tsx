import Link from "next/link";

import { TopRail } from "@/components/top-rail";
import { RoutePanel } from "@/components/route-panel";
import { RagChatWidget } from "@/components/rag-chat-widget";
import { TranscriptReader } from "@/components/transcript-reader";
import { getEpisodeDetail } from "@/lib/podcast-data";
import { canMutateForRole, requireSignedInAppUser } from "@/lib/rbac";

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
  const appUser = await requireSignedInAppUser();
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
