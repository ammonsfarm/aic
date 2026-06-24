import Link from "next/link";

import { RoutePanel } from "@/components/route-panel";
import { TopRail } from "@/components/top-rail";
import { getEpisodeStatisticsDashboard, parsePodtracRange, podtracRangeOptions } from "@/lib/podcast-data";

export const dynamic = "force-dynamic";

const countFormat = new Intl.NumberFormat("en-US");

function formatCount(value: number) {
  return countFormat.format(value);
}

function formatDate(value: string | null) {
  if (!value) {
    return "No date";
  }

  const dateOnly = value.slice(0, 10);
  const parts = dateOnly.split("-").map(Number);
  const date =
    parts.length === 3 && parts.every(Number.isFinite)
      ? new Date(parts[0], parts[1] - 1, parts[2])
      : new Date(value);

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatCoverage(startDate: string | null, endDate: string | null) {
  if (!startDate || !endDate) {
    return "No imported daily data yet.";
  }

  return `Imported daily data covers ${formatDate(startDate)} through ${formatDate(endDate)}.`;
}

function RangeForm({ value, trackId }: { value: string; trackId?: string }) {
  return (
    <form className="range-form" method="get">
      {trackId ? <input type="hidden" name="trackId" value={trackId} /> : null}
      <label>
        <span>Drill-down range</span>
        <select name="range" defaultValue={value}>
          {podtracRangeOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button className="button button--ghost" type="submit">
        Apply
      </button>
    </form>
  );
}

function EpisodeTrend({ rows }: { rows: Array<{ activityDate: string; downloads: number }> }) {
  const maxDownloads = Math.max(...rows.map((row) => row.downloads), 1);

  return (
    <div className="episode-trend-list">
      {rows.map((row) => (
        <div key={row.activityDate} className="trend-row">
          <span>{formatDate(row.activityDate)}</span>
          <div className="trend-row__bar" aria-hidden="true">
            <i style={{ width: `${Math.max(3, Math.round((row.downloads / maxDownloads) * 100))}%` }} />
          </div>
          <strong>{formatCount(row.downloads)}</strong>
        </div>
      ))}
    </div>
  );
}

export default async function EpisodeStatisticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; trackId?: string }>;
}) {
  const params = await searchParams;
  const range = parsePodtracRange(params.range);
  const dashboard = await getEpisodeStatisticsDashboard({ rangeKey: range, trackId: params.trackId });
  const selected = dashboard.selectedEpisode;
  const activeSummary = selected ?? dashboard.summary;
  const activeTrend = selected ? dashboard.selectedDailyTrend : dashboard.dailyTrend;
  const maxEpisodeDownloads = Math.max(...dashboard.episodes.map((episode) => episode.importedDownloads), 1);

  return (
    <>
      <TopRail variant="public" />
      <main className="public-shell">
        <RoutePanel
          eyebrow="Podcast"
          title="Episode Statistics"
          aside={
            <div className="stats-aside">
              <strong>Episode rows</strong>
              <span>{formatCount(dashboard.summary.matchedEpisodes)} matched archive episodes</span>
              <small>{formatCoverage(dashboard.range.minDate, dashboard.range.maxDate)}</small>
              <Link className="button button--ghost" href="/podcast">
                Podcast Statistics
              </Link>
              {selected ? (
                <Link className="button button--ghost" href={`/podcast/episodes?range=${dashboard.range.key}`}>
                  All Episodes
                </Link>
              ) : null}
            </div>
          }
        >
          <section className="split-board split-board--wide">
            <div>
              <div className="chart-section-head">
                <div>
                  <p className="eyebrow">{selected ? "Episode drill-down" : "All matched episodes"}</p>
                  <h2>{selected?.title ?? "Episode downloads by day"}</h2>
                </div>
                <RangeForm value={dashboard.range.key} trackId={selected?.trackId} />
              </div>
              {dashboard.episodes.length > 0 ? (
                <>
                  <div className="episode-stat-summary">
                    <span>
                      <strong>{formatCount(activeSummary.importedDownloads)}</strong>
                      Imported downloads
                    </span>
                    <span>
                      <strong>{formatCount(activeSummary.rangeDownloads)}</strong>
                      {dashboard.range.label} downloads
                    </span>
                    <span>
                      <strong>{formatDate(activeSummary.lastActivityDate)}</strong>
                      Last activity
                    </span>
                  </div>
                  <p className="note episode-coverage-note">
                    {selected
                      ? `${formatCoverage(selected.firstActivityDate, selected.lastActivityDate)} This range is for the selected episode.`
                      : formatCoverage(dashboard.range.minDate, dashboard.range.maxDate)}
                  </p>
                  <EpisodeTrend rows={activeTrend} />
                </>
              ) : (
                <p className="note">No matched Podtrac episode rows are available.</p>
              )}
            </div>

            <div>
              <p className="eyebrow">{dashboard.range.label}</p>
              <h2>Available breakdowns</h2>
              <p className="note">
                Episode rows have exact imported daily downloads. Country and client tables are podcast-wide for the selected
                window, not exact per-episode cross-tabs.
              </p>
              <div className="stats-mix-grid stats-mix-grid--stack">
                <div>
                  <p className="note">Top countries, podcast-wide</p>
                  <div className="status-list status-list--compact">
                    {dashboard.countryDownloads.map((row) => (
                      <span key={row.country}>
                        <strong>{row.country}</strong>
                        {formatCount(row.downloads)}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="note">Top clients, podcast-wide</p>
                  <div className="status-list status-list--compact">
                    {dashboard.clientDownloads.map((row) => (
                      <span key={row.client}>
                        <strong>{row.client}</strong>
                        {formatCount(row.downloads)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="podcast-chart-section">
            <div className="chart-section-head">
              <div>
                <p className="eyebrow">All episodes</p>
                <h2>Downloads by episode</h2>
              </div>
              <span className="scope-pill">Sorted by imported downloads</span>
            </div>
            <div className="episode-stat-table">
              {dashboard.episodes.map((episode) => {
                const selectedRow = episode.trackId === selected?.trackId;
                return (
                  <Link
                    key={episode.trackId}
                    href={`/podcast/episodes?trackId=${episode.trackId}&range=${dashboard.range.key}`}
                    className={selectedRow ? "episode-stat-row episode-stat-row--selected" : "episode-stat-row"}
                    aria-current={selectedRow ? "page" : undefined}
                  >
                    <span className="episode-stat-row__title">
                      <strong>{episode.title}</strong>
                      <small>{formatDate(episode.publishDate)}</small>
                    </span>
                    <span className="episode-stat-row__bar" aria-hidden="true">
                      <i style={{ width: `${Math.max(2, Math.round((episode.importedDownloads / maxEpisodeDownloads) * 100))}%` }} />
                    </span>
                    <span>
                      <strong>{formatCount(episode.importedDownloads)}</strong>
                      <small>imported</small>
                    </span>
                    <span>
                      <strong>{formatCount(episode.rangeDownloads)}</strong>
                      <small>{dashboard.range.label}</small>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        </RoutePanel>
      </main>
    </>
  );
}
