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

function episodeStatsHref({
  range,
  trackId,
  downloadDate,
  hash,
}: {
  range: string;
  trackId?: string;
  downloadDate?: string | null;
  hash?: string;
}) {
  const params = new URLSearchParams({ range });
  if (trackId) {
    params.set("trackId", trackId);
  }
  if (downloadDate) {
    params.set("downloadDate", downloadDate);
  }

  return `/podcast/episodes?${params.toString()}${hash ? `#${hash}` : ""}`;
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

function EpisodeTrend({
  rows,
  range,
  trackId,
  selectedDownloadDate,
}: {
  rows: Array<{ activityDate: string; downloads: number }>;
  range: string;
  trackId?: string;
  selectedDownloadDate: string | null;
}) {
  const maxDownloads = Math.max(...rows.map((row) => row.downloads), 1);

  return (
    <div className="episode-trend-list">
      {rows.map((row) => {
        const selected = row.activityDate === selectedDownloadDate;
        return (
          <Link
            key={row.activityDate}
            className={selected ? "trend-row trend-row--selected" : "trend-row"}
            href={episodeStatsHref({ range, trackId, downloadDate: row.activityDate, hash: "date-drilldown" })}
            aria-current={selected ? "location" : undefined}
          >
            <span>{formatDate(row.activityDate)}</span>
            <div className="trend-row__bar" aria-hidden="true">
              <i style={{ width: `${Math.max(3, Math.round((row.downloads / maxDownloads) * 100))}%` }} />
            </div>
            <strong>{formatCount(row.downloads)}</strong>
          </Link>
        );
      })}
    </div>
  );
}

function DateEpisodeGrid({
  rows,
  range,
  selectedTrackId,
  selectedDownloadDate,
}: {
  rows: Array<{ downloadDate: string; trackId: string; title: string; publishDate: string; downloads: number }>;
  range: string;
  selectedTrackId?: string;
  selectedDownloadDate: string;
}) {
  return (
    <section className="podcast-chart-section episode-date-drilldown" id="date-drilldown">
      <div className="chart-section-head">
        <div>
          <p className="eyebrow">Date drill-down</p>
          <h2>Episodes downloaded on {formatDate(selectedDownloadDate)}</h2>
        </div>
        <Link className="button button--ghost" href={episodeStatsHref({ range, trackId: selectedTrackId })}>
          Clear Date
        </Link>
      </div>
      <div className="episode-date-grid" role="table" aria-label={`Episode downloads on ${formatDate(selectedDownloadDate)}`}>
        <div className="episode-date-grid__head" role="row">
          <span role="columnheader">Download Date</span>
          <span role="columnheader">Episode</span>
          <span role="columnheader">Count</span>
        </div>
        {rows.length > 0 ? (
          rows.map((row) => (
            <Link
              key={`${row.downloadDate}-${row.trackId}`}
              className="episode-date-grid__row"
              href={episodeStatsHref({ range, trackId: row.trackId, downloadDate: row.downloadDate, hash: "date-drilldown" })}
              role="row"
            >
              <span role="cell">{formatDate(row.downloadDate)}</span>
              <span className="episode-date-grid__episode" role="cell">
                <strong>{row.title}</strong>
                <small>{formatDate(row.publishDate)}</small>
              </span>
              <span className="episode-date-grid__count" role="cell">{formatCount(row.downloads)}</span>
            </Link>
          ))
        ) : (
          <div className="episode-date-grid__empty" role="row">
            <span role="cell">No episode downloads were imported for this date.</span>
          </div>
        )}
      </div>
    </section>
  );
}

export default async function EpisodeStatisticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; trackId?: string; downloadDate?: string }>;
}) {
  const params = await searchParams;
  const range = parsePodtracRange(params.range);
  const dashboard = await getEpisodeStatisticsDashboard({
    rangeKey: range,
    trackId: params.trackId,
    downloadDate: params.downloadDate,
  });
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
                  <EpisodeTrend
                    rows={activeTrend}
                    range={dashboard.range.key}
                    trackId={selected?.trackId}
                    selectedDownloadDate={dashboard.selectedDownloadDate}
                  />
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

          {dashboard.selectedDownloadDate ? (
            <DateEpisodeGrid
              rows={dashboard.dateEpisodeDownloads}
              range={dashboard.range.key}
              selectedTrackId={selected?.trackId}
              selectedDownloadDate={dashboard.selectedDownloadDate}
            />
          ) : null}

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
	                    href={episodeStatsHref({
	                      range: dashboard.range.key,
	                      trackId: episode.trackId,
	                      downloadDate: dashboard.selectedDownloadDate,
	                    })}
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
