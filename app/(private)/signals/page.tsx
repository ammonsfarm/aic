import Link from "next/link";

import { RoutePanel } from "@/components/route-panel";
import { getPodtracDashboard } from "@/lib/podcast-data";

type MetricPair = {
  label: string;
  value: number;
  tone: "primary" | "warn" | "muted";
};

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
  return new Intl.NumberFormat("en-US").format(value);
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

export default async function SignalsPage() {
  const dashboard = await getPodtracDashboard();

  const coveragePairs: MetricPair[] = [
    { label: "Episodes", value: dashboard.counts.episodes, tone: "primary" },
    { label: "Episodes with transcript chunks", value: dashboard.counts.transcriptEpisodes, tone: "primary" },
    { label: "Transcript chunks", value: dashboard.counts.transcriptChunks, tone: "primary" },
    { label: "Speech vectors", value: dashboard.counts.speechVectors, tone: "primary" },
    { label: "Intelligence rows", value: dashboard.counts.intelligenceRows, tone: "primary" },
    { label: "Intelligence vectors", value: dashboard.counts.intelligenceVectors, tone: "primary" },
    { label: "Unmatched Podtrac episodes", value: dashboard.counts.podtracUnmatched, tone: "warn" },
  ];

  return (
    <RoutePanel
      eyebrow="Signals"
      title="Podcast stats and listenership"
      aside={
        <div className="note" style={{ display: "grid", gap: 10 }}>
          <strong>Download scope</strong>
          <span>Podtrac data below reflects current sync tables as ingested into Postgres.</span>
          <Link className="button button--ghost" href="/signals" aria-label="Refresh signal data">
            Refresh now
          </Link>
        </div>
      }
    >
      <section className="signal-board">
        <div>
          <p className="eyebrow">Podtrac total</p>
          <h2>Total indexed downloads</h2>
          <p className="signal-kpi">{formatCount(dashboard.counts.totalDownloads)}</p>
          <p className="note">Matches include daily activity for all synced Podtrac rows.</p>
        </div>
        <div className="status-list status-list--wide">
          <span>
            <strong>Podtrac episodes</strong>
            {formatCount(dashboard.counts.podtracEpisodes)}
          </span>
          <span>
            <strong>Matched to episodes</strong>
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
          <p className="eyebrow">Corpus coverage</p>
          <h2>Primary corpus counts</h2>
          <div className="status-list signal-status-grid">
            {coveragePairs.map((item) => (
              <span key={item.label} className={metricToneClass(item.tone)}>
                <strong>{item.label}</strong>
                {formatCount(item.value)}
              </span>
            ))}
          </div>
        </div>

        <div>
          <p className="eyebrow">Top podtrac-linked episodes</p>
          <h2>Top 6 by downloads</h2>
          <div className="status-list status-list--compact">
            {dashboard.topEpisodes.slice(0, 6).map((row) => (
              <span key={`${row.trackId}-${row.totalDownloads}`} className="status-item">
                <Link href={`/episodes/${row.trackId}`}>
                  <strong>{row.episodeTitle || row.podtracEpisodeTitle}</strong>
                </Link>
                <span>{formatDate(row.publishDate)}</span>
                <span>downloads: {formatCount(row.totalDownloads)}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="split-board">
        <div>
          <p className="eyebrow">Daily listenership</p>
          <h2>Most recent activity</h2>
          <div className="status-list">
            {dashboard.dailyTrend.slice(0, 8).map((row) => (
              <span key={`${row.activityDate}-${row.downloads}`}>
                <strong>{formatDate(row.activityDate)}</strong>
                {formatCount(row.downloads)} downloads
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="eyebrow">Audience mix</p>
          <h2>Top countries and clients</h2>
          <div className="status-list">
            <div className="note" style={{ marginBottom: 8 }}>
              Country and client rows represent normalized podtrac metadata where available.
            </div>
            <div>
              <p className="note">Top countries</p>
              <div className="status-list status-list--compact">
                {dashboard.countryDownloads.slice(0, 5).map((row) => (
                  <span key={row.country}>
                    <strong>{row.country}</strong>
                    {formatCount(row.downloads)}
                  </span>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <p className="note">Top clients</p>
              <div className="status-list status-list--compact">
                {dashboard.clientDownloads.slice(0, 5).map((row) => (
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
    </RoutePanel>
  );
}
