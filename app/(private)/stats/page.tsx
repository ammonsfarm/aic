import Link from "next/link";

import { RoutePanel } from "@/components/route-panel";
import { getPodtracDashboard } from "@/lib/podcast-data";

type MetricPair = {
  label: string;
  value: number;
  tone: "primary" | "warn" | "muted";
};

const countFormat = new Intl.NumberFormat("en-US");

function formatDate(value: string | null) {
  if (!value) {
    return "No date";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatCount(value: number) {
  return countFormat.format(value);
}

function metricToneClass(tone: MetricPair["tone"]) {
  if (tone === "warn") {
    return "signal-stat signal-stat--warn";
  }

  if (tone === "muted") {
    return "signal-stat signal-stat--muted";
  }

  return "signal-stat";
}

function trendShare(value: number, max: number) {
  if (max <= 0) {
    return "0%";
  }

  return `${Math.max(4, Math.round((value / max) * 100))}%`;
}

export default async function StatsPage() {
  const dashboard = await getPodtracDashboard();
  const recentTrend = dashboard.dailyTrend.slice(0, 14);
  const peakRecentDownloads = Math.max(...recentTrend.map((row) => row.downloads), 0);

  const coveragePairs: MetricPair[] = [
    { label: "Episodes", value: dashboard.counts.episodes, tone: "primary" },
    { label: "Episodes with transcripts", value: dashboard.counts.transcriptEpisodes, tone: "primary" },
    { label: "Transcript chunks", value: dashboard.counts.transcriptChunks, tone: "primary" },
    { label: "Speech vectors", value: dashboard.counts.speechVectors, tone: "primary" },
    { label: "Intelligence rows", value: dashboard.counts.intelligenceRows, tone: "primary" },
    { label: "Intelligence vectors", value: dashboard.counts.intelligenceVectors, tone: "primary" },
    { label: "Unmatched Podtrac episodes", value: dashboard.counts.podtracUnmatched, tone: "warn" },
  ];

  return (
    <RoutePanel
      eyebrow="Stats"
      title="Podcast listenership"
      aside={
        <div className="note stats-aside">
          <strong>Indexed Podtrac window</strong>
          <span>
            {formatDate(dashboard.counts.activityStart)} through {formatDate(dashboard.counts.activityEnd)}
          </span>
          <Link className="button button--ghost" href="/pipeline">
            Check pipeline
          </Link>
        </div>
      }
    >
      <section className="signal-board stats-hero">
        <div>
          <p className="eyebrow">Podtrac total</p>
          <h2>Total indexed downloads</h2>
          <p className="signal-kpi">{formatCount(dashboard.counts.totalDownloads)}</p>
          <p className="note">
            Private Podtrac daily activity currently loaded into Postgres. Public visitors do not see this data.
          </p>
        </div>
        <div className="status-list status-list--wide">
          <span>
            <strong>Podtrac episodes</strong>
            {formatCount(dashboard.counts.podtracEpisodes)}
          </span>
          <span>
            <strong>Matched to archive</strong>
            {formatCount(dashboard.counts.podtracMatched)}
          </span>
          <span>
            <strong>Unmatched</strong>
            {formatCount(dashboard.counts.podtracUnmatched)}
          </span>
          <span>
            <strong>Activity rows</strong>
            {formatCount(dashboard.counts.podtracDailyRows)}
          </span>
        </div>
      </section>

      <section className="split-board split-board--wide">
        <div>
          <p className="eyebrow">Recent trend</p>
          <h2>Last 14 indexed days</h2>
          <div className="trend-list" aria-label="Recent Podtrac download trend">
            {recentTrend.map((row) => (
              <div key={`${row.activityDate}-${row.downloads}`} className="trend-row">
                <span>{formatDate(row.activityDate)}</span>
                <div className="trend-row__bar" aria-hidden="true">
                  <i style={{ width: trendShare(row.downloads, peakRecentDownloads) }} />
                </div>
                <strong>{formatCount(row.downloads)}</strong>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="eyebrow">Top episodes</p>
          <h2>Highest downloads</h2>
          <div className="stats-ranked-list">
            {dashboard.topEpisodes.slice(0, 8).map((row, index) => (
              <Link key={`${row.trackId}-${row.totalDownloads}`} href={`/episodes/${row.trackId}`} className="stats-ranked-row">
                <span>{index + 1}</span>
                <strong>{row.episodeTitle || row.podtracEpisodeTitle}</strong>
                <small>{formatDate(row.publishDate)}</small>
                <em>{formatCount(row.totalDownloads)}</em>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="split-board">
        <div>
          <p className="eyebrow">Audience mix</p>
          <h2>Countries and listening clients</h2>
          <div className="stats-mix-grid">
            <div>
              <p className="note">Top countries</p>
              <div className="status-list status-list--compact">
                {dashboard.countryDownloads.slice(0, 6).map((row) => (
                  <span key={row.country}>
                    <strong>{row.country}</strong>
                    {formatCount(row.downloads)}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="note">Top clients</p>
              <div className="status-list status-list--compact">
                {dashboard.clientDownloads.slice(0, 6).map((row) => (
                  <span key={row.client}>
                    <strong>{row.client}</strong>
                    {formatCount(row.downloads)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div>
          <p className="eyebrow">Corpus readiness</p>
          <h2>Research coverage beside stats</h2>
          <div className="status-list signal-status-grid">
            {coveragePairs.map((item) => (
              <span key={item.label} className={metricToneClass(item.tone)}>
                <strong>{item.label}</strong>
                {formatCount(item.value)}
              </span>
            ))}
          </div>
        </div>
      </section>
    </RoutePanel>
  );
}
