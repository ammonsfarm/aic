import Link from "next/link";

import { RoutePanel } from "@/components/route-panel";
import { TopRail } from "@/components/top-rail";
import { getPastorWoodWritings, type PastorWoodWritingsSummary } from "@/lib/pastorwood-writings";

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

function dateRange(summary: PastorWoodWritingsSummary | undefined) {
  if (!summary?.firstDate || !summary.lastDate) {
    return "Dates pending";
  }

  return `${formatDate(summary.firstDate)} to ${formatDate(summary.lastDate)}`;
}

export default async function WritingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const data = await getPastorWoodWritings({ query: q, limit: 36 });
  const devotionalSummary = data.summaries.find((summary) => summary.sourceType === "pastorwood_devotional");
  const resultLabel = data.query ? `${data.rows.length} matching ${data.rows.length === 1 ? "entry" : "entries"}` : "Latest entries";

  return (
    <>
      <TopRail variant="public" />
      <main className="public-shell">
        <RoutePanel
          eyebrow="Pastor Wood Writings"
          title="Devotionals and written work"
          aside={
            <div className="writings-aside">
              <span>
                <strong>{devotionalSummary?.postCount.toLocaleString() ?? "0"}</strong>
                <small>Weekly devotionals indexed</small>
              </span>
              <span>
                <strong>{devotionalSummary?.embeddedChunkCount.toLocaleString() ?? "0"}</strong>
                <small>Searchable RAG excerpts</small>
              </span>
              <p>{dateRange(devotionalSummary)}</p>
              <p className="note">Book texts can join this collection as a separate writing type when source text is ready.</p>
            </div>
          }
        >
          <div className="writings-index">
            <form action="/writings" className="writings-search">
              <label htmlFor="writings-query">Search devotionals</label>
              <div>
                <input
                  id="writings-query"
                  name="q"
                  type="search"
                  defaultValue={data.query}
                  placeholder="Search by topic, passage, phrase, or title"
                />
                <button className="button button--primary" type="submit">Search</button>
                {data.query ? (
                  <Link className="button button--ghost" href="/writings">
                    Clear
                  </Link>
                ) : null}
              </div>
            </form>

            <div className="writings-results__head">
              <p className="eyebrow">{resultLabel}</p>
              {data.query ? <p>Search: {data.query}</p> : null}
            </div>

            {data.rows.length === 0 ? (
              <p className="empty-state">No devotionals matched that search.</p>
            ) : (
              <div className="writings-results">
                {data.rows.map((row) => (
                  <article key={row.postId} className="writing-row">
                    <div className="writing-row__main">
                      <p className="eyebrow">{formatDate(row.publishDate)} · {row.sourceLabel}</p>
                      <h2>
                        <a href={row.sourceUrl} target="_blank" rel="noopener">
                          {row.title}
                        </a>
                      </h2>
                      {row.snippet ? <p>{row.snippet}</p> : null}
                    </div>
                    <div className="writing-row__actions">
                      <span>{row.sourceType.replace(/^pastorwood_/, "")}</span>
                      <a className="button button--ghost" href={row.sourceUrl} target="_blank" rel="noopener">
                        Open source
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </RoutePanel>
      </main>
    </>
  );
}
