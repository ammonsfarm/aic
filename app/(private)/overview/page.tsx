import { MountainPanel } from "@/components/mountain-panel";
import { getOverviewData } from "@/lib/overview-data";

const numberFormat = new Intl.NumberFormat("en-US");

function formatNumber(value: number) {
  return numberFormat.format(value);
}

function formatDate(value: string | null) {
  if (!value) {
    return "No completed run";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function OverviewPage() {
  const result = await getOverviewData();

  return (
    <div className="stack">
      <MountainPanel
        eyebrow="Overview"
        title="Morning corpus desk"
        body="Live serving-database checks for corpus coverage, Podtrac linkage, source-backed intelligence, and pipeline warnings."
      />

      {!result.ok ? (
        <section className="signal-board signal-board--warning">
          <div>
            <p className="eyebrow">Database check</p>
            <h2>{result.type === "missing-env" ? "Missing database environment" : "Postgres connection failed"}</h2>
            <p>
              {result.type === "missing-env"
                ? `Missing required variables: ${result.missing.join(", ")}. Values are intentionally not shown.`
                : "The private console is protected, but live overview data could not be read from Postgres."}
            </p>
          </div>
          <div className="status-list" aria-label="Database status">
            <span>
              <strong>Auth</strong>
              Clerk protected layout
            </span>
            <span>
              <strong>Data</strong>
              {result.type === "database-error" ? result.message : "Waiting on env"}
            </span>
          </div>
        </section>
      ) : (
        <>
          <section className="overview-grid" aria-label="Corpus overview">
            <div className="overview-primary">
              <p className="eyebrow">Podtrac clean window</p>
              <h2>{formatNumber(result.data.counts.cleanWindowDownloads)} downloads</h2>
              <p>Exact Podtrac daily-activity total for Feb 1, 2026 through Apr 30, 2026.</p>
            </div>
            <div className="overview-stat">
              <strong>{formatNumber(result.data.counts.episodes)}</strong>
              <span>Episodes</span>
            </div>
            <div className="overview-stat">
              <strong>{formatNumber(result.data.counts.transcriptChunks)}</strong>
              <span>Speech transcript chunks</span>
            </div>
            <div className="overview-stat overview-stat--warn">
              <strong>{formatNumber(result.data.counts.podtracUnmatched)}</strong>
              <span>Unmatched Podtrac episodes</span>
            </div>
          </section>

          <section className="split-board">
            <div>
              <p className="eyebrow">Corpus coverage</p>
              <h2>Serving database status</h2>
              <div className="coverage-list">
                <span>
                  <strong>{formatNumber(result.data.counts.transcriptEpisodes)}</strong>
                  Episodes with transcripts
                </span>
                <span>
                  <strong>{formatNumber(result.data.counts.speechVectors)}</strong>
                  Speech vectors
                </span>
                <span>
                  <strong>{formatNumber(result.data.counts.intelligence)}</strong>
                  Intelligence rows
                </span>
                <span>
                  <strong>{formatNumber(result.data.counts.intelligenceItems)}</strong>
                  Intelligence items
                </span>
                <span>
                  <strong>{formatNumber(result.data.counts.intelligenceVectors)}</strong>
                  Intelligence vectors
                </span>
              </div>
            </div>
            <div>
              <p className="eyebrow">Podtrac linkage</p>
              <h2>Match state</h2>
              <div className="coverage-list">
                <span>
                  <strong>{formatNumber(result.data.counts.podtracEpisodes)}</strong>
                  Podtrac episode rows
                </span>
                <span>
                  <strong>{formatNumber(result.data.counts.podtracMatched)}</strong>
                  Matched to canonical episodes
                </span>
                <span>
                  <strong>{formatNumber(result.data.counts.podtracDailyRows)}</strong>
                  Daily activity rows
                </span>
                <span>
                  <strong>{formatNumber(result.data.counts.podtracCountryRows)}</strong>
                  Country activity rows, not episode by country
                </span>
                <span>
                  <strong>{formatNumber(result.data.counts.podtracClientRows)}</strong>
                  Client activity rows
                </span>
              </div>
            </div>
          </section>

          <section className="split-board split-board--wide">
            <div>
              <p className="eyebrow">Recent episodes</p>
              <h2>Latest indexed records</h2>
              <div className="episode-list">
                {result.data.recentEpisodes.map((episode) => (
                  <article key={episode.track_id} className="episode-row">
                    <div>
                      <strong>{episode.title}</strong>
                      <span>{episode.publish_date || "No publish date"}</span>
                    </div>
                    <div className="episode-badges" aria-label={`${episode.title} status`}>
                      <span>{episode.has_transcript ? "Transcript" : "No transcript"}</span>
                      <span>{episode.has_intelligence ? "Intelligence" : "No intelligence"}</span>
                      <span>{episode.podtrac_match_status || "No Podtrac link"}</span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <div>
              <p className="eyebrow">Pipeline signals</p>
              <h2>Warnings and syncs</h2>
              <div className="status-list status-list--wide">
                <span>
                  <strong>Episode by country</strong>
                  Current Podtrac import is not an exact episode-country cross-tab.
                </span>
                {result.data.intelligenceStatus.map((item) => (
                  <span key={item.status}>
                    <strong>{item.status}</strong>
                    {formatNumber(item.count)} intelligence rows
                  </span>
                ))}
                {result.data.latestSyncRuns.map((run) => (
                  <span key={`${run.source}-${run.completed_at ?? run.status}`}>
                    <strong>{run.source} sync</strong>
                    {run.status} · {formatDate(run.completed_at)}
                  </span>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
