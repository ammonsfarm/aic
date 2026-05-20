import Link from "next/link";

import { RoutePanel } from "@/components/route-panel";
import { TopRail } from "@/components/top-rail";
import { getSermonCatalog } from "@/lib/sermon-catalog";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
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

export default async function SermonsPage() {
  const catalog = await getSermonCatalog();
  const oldTestament = catalog.books.filter((book) => book.testament === "Old Testament");
  const newTestament = catalog.books.filter((book) => book.testament === "New Testament");
  const activeBooks = catalog.books.filter((book) => book.sermonCount > 0).length;
  const activeChapters = catalog.books.reduce((sum, book) => sum + book.chaptersWithSermons, 0);

  return (
    <>
      <TopRail variant="public" />
      <main className="public-shell">
        <RoutePanel
          eyebrow="Sermon scripture index"
          title="Sermons by Bible book and chapter"
          aside={
            <div className="sermon-index-summary">
              <span>
                <strong>{catalog.matchedEpisodeCount.toLocaleString()}</strong>
                <small>Episodes with main passage metadata</small>
              </span>
              <span>
                <strong>{activeBooks}</strong>
                <small>Books with sermons</small>
              </span>
              <span>
                <strong>{activeChapters}</strong>
                <small>Chapters with sermons</small>
              </span>
              <p className="note">
                Placement uses the episode title/detail main subject only. Transcript references and supporting scriptures are intentionally excluded.
              </p>
            </div>
          }
        >
          <div className="sermon-index">
            <section className="sermon-testament">
              <h2>Old Testament</h2>
              <BookList books={oldTestament} />
            </section>

            <section className="sermon-testament">
              <h2>New Testament</h2>
              <BookList books={newTestament} />
            </section>
          </div>
        </RoutePanel>
      </main>
    </>
  );
}

function BookList({ books }: { books: Awaited<ReturnType<typeof getSermonCatalog>>["books"] }) {
  return (
    <div className="sermon-book-list">
      {books.map((book) => (
        <details key={book.name} className="sermon-book">
          <summary>
            <span className="sermon-summary-main">
              <span className="sermon-chevron" aria-hidden="true">›</span>
              <span>
                <strong>{book.name}</strong>
                <small>{book.chapterCount} chapters</small>
              </span>
            </span>
            <span className={book.sermonCount > 0 ? "sermon-count sermon-count--active" : "sermon-count"}>
              {book.sermonCount} {book.sermonCount === 1 ? "sermon" : "sermons"}
            </span>
          </summary>

          <div className="sermon-chapter-list">
            {book.chapters.map((chapter) => {
              if (chapter.sermons.length === 0) {
                return (
                  <div key={chapter.number} className="sermon-chapter sermon-chapter--empty">
                    <span>Chapter {chapter.number}</span>
                    <small>No sermon assigned</small>
                  </div>
                );
              }

              return (
                <details key={chapter.number} className="sermon-chapter sermon-chapter--filled">
                  <summary>
                    <span className="sermon-summary-main">
                      <span className="sermon-chevron" aria-hidden="true">›</span>
                      <span>Chapter {chapter.number}</span>
                    </span>
                    <small>{chapter.sermons.length} {chapter.sermons.length === 1 ? "sermon" : "sermons"}</small>
                  </summary>
                  <div className="sermon-card-list">
                    {chapter.sermons.map((sermon) => (
                      <article key={`${chapter.number}-${sermon.trackId}`} className="sermon-card">
                        <div>
                          <p className="eyebrow">{formatDate(sermon.publishDate)}</p>
                          <h3>{sermon.title}</h3>
                          <p>{sermon.passageLabel}</p>
                        </div>
                        <div className="sermon-card__meta">
                          <span>{sermon.category || "Episode"}</span>
                          <Link className="button button--ghost" href={`/episodes/${sermon.trackId}`}>
                            Open episode
                          </Link>
                        </div>
                      </article>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}
