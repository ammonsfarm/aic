import Link from "next/link";
import { notFound } from "next/navigation";

import { RagChatWidget } from "@/components/rag-chat-widget";
import { RoutePanel } from "@/components/route-panel";
import { TopRail } from "@/components/top-rail";
import { getPastorWoodWritingBySlug } from "@/lib/pastorwood-writings";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  if (!value) {
    return "No date";
  }

  const parsed = new Date(`${value}T00:00:00Z`);
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

export default async function WritingDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const detail = await getPastorWoodWritingBySlug(decodeURIComponent(slug));

  if (!detail) {
    notFound();
  }

  return (
    <>
      <TopRail variant="public" />
      <main className="public-shell">
        <RoutePanel
          eyebrow={detail.sourceLabel}
          title={detail.title}
          actions={
            <div className="compact-actions">
              <Link className="button button--ghost" href="/writings">
                Back to writings
              </Link>
              <a className="button button--primary" href={detail.sourceUrl} target="_blank" rel="noopener noreferrer">
                Original source
              </a>
            </div>
          }
        >
          <section className="writing-detail-grid">
            <div>
              <h3>Writing metadata</h3>
              <div className="meta-list">
                <p>
                  <strong>Date</strong> {formatDate(detail.publishDate)}
                </p>
                <p>
                  <strong>Type</strong> {detail.sourceLabel}
                </p>
                <p>
                  <strong>Post</strong> {detail.postId}
                </p>
              </div>
              <div className="status-pills status-pills--compact">
                <span>{detail.chunkCount.toLocaleString()} local excerpt{detail.chunkCount === 1 ? "" : "s"}</span>
                <span>{detail.embeddedChunkCount.toLocaleString()} embedded</span>
              </div>
            </div>

            <div>
              <RagChatWidget
                action={`/api/writings/${detail.postId}/chat`}
                heading="Research"
                description="Ask questions that should be answered from this writing only."
                submitLabel="Ask writing"
                sourceLabel="Writing sources"
                compactMode
                historyScope="writing"
                historyTrackId={`pastorwood:${detail.postId}`}
                starterQuestions={[
                  "What is the main spiritual emphasis?",
                  "What Scripture passages are central here?",
                  "Summarize this writing in a few sentences.",
                ]}
              />
            </div>
          </section>

          <section className="detail-section">
            <h3>Generated summary</h3>
            <div className="summary-block">
              <p>{detail.summary || "A generated summary has not been created for this writing yet."}</p>
            </div>
          </section>

          <section className="detail-section writing-article-section">
            <h3>Full text</h3>
            <article className="writing-article">
              {detail.paragraphs.length > 0 ? (
                detail.paragraphs.map((paragraph, index) => <p key={`${detail.postId}-${index}`}>{paragraph}</p>)
              ) : (
                <p className="empty-state">No local text is available for this writing.</p>
              )}
            </article>
          </section>
        </RoutePanel>
      </main>
    </>
  );
}
