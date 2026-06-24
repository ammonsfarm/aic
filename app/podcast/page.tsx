import Link from "next/link";

import { RoutePanel } from "@/components/route-panel";
import { TopRail } from "@/components/top-rail";
import {
  getPodcastStatsDashboard,
  parsePodtracRange,
  podtracRangeOptions,
  type PodcastStatsDashboard,
} from "@/lib/podcast-data";
import { isCurrentUserAdministrator } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const countFormat = new Intl.NumberFormat("en-US");
const chartColors = [
  "oklch(34% 0.07 156)",
  "oklch(52% 0.058 156)",
  "oklch(58% 0.09 54)",
  "oklch(70% 0.09 78)",
  "oklch(44% 0.052 205)",
  "oklch(48% 0.065 120)",
  "oklch(55% 0.075 36)",
  "oklch(40% 0.050 250)",
  "oklch(62% 0.060 95)",
  "oklch(46% 0.050 180)",
];

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

function formatCompactDate(value: string) {
  const dateOnly = value.slice(0, 10);
  const parts = dateOnly.split("-").map(Number);
  const date =
    parts.length === 3 && parts.every(Number.isFinite)
      ? new Date(parts[0], parts[1] - 1, parts[2])
      : new Date(value);

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  const commands = [`M ${points[0].x} ${points[0].y}`];

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const previous = points[index - 1] ?? current;
    const afterNext = points[index + 2] ?? next;
    const cp1x = current.x + (next.x - previous.x) / 6;
    const cp1y = current.y + (next.y - previous.y) / 6;
    const cp2x = next.x - (afterNext.x - current.x) / 6;
    const cp2y = next.y - (afterNext.y - current.y) / 6;

    commands.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`);
  }

  return commands.join(" ");
}

function RangeForm({
  name,
  value,
  label,
  hidden,
}: {
  name: string;
  value: string;
  label: string;
  hidden?: Record<string, string>;
}) {
  return (
    <form className="range-form" method="get">
      {hidden
        ? Object.entries(hidden).map(([key, hiddenValue]) => <input key={key} type="hidden" name={key} value={hiddenValue} />)
        : null}
      <label>
        <span>{label}</span>
        <select name={name} defaultValue={value}>
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

function LineChart({ rows }: { rows: PodcastStatsDashboard["dailyTrend"] }) {
  const width = 760;
  const height = 260;
  const padding = { top: 18, right: 28, bottom: 36, left: 56 };
  const maxDownloads = Math.max(...rows.map((row) => row.downloads), 1);
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const points = rows.map((row, index) => {
    const x = padding.left + (rows.length <= 1 ? 0 : (index / (rows.length - 1)) * chartWidth);
    const y = padding.top + chartHeight - (row.downloads / maxDownloads) * chartHeight;
    return { x, y };
  });
  const areaPath =
    points.length > 0
      ? `${smoothPath(points)} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${
          padding.top + chartHeight
        } Z`
      : "";
  const labelIndexes = rows.length > 1 ? [0, Math.floor((rows.length - 1) / 2), rows.length - 1] : [0];

  return (
    <div className="chart-frame">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily downloads line chart">
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + chartHeight} className="chart-axis" />
        <line
          x1={padding.left}
          y1={padding.top + chartHeight}
          x2={padding.left + chartWidth}
          y2={padding.top + chartHeight}
          className="chart-axis"
        />
        {[0, 0.5, 1].map((tick) => {
          const y = padding.top + chartHeight - tick * chartHeight;
          return (
            <g key={tick}>
              <line x1={padding.left} y1={y} x2={padding.left + chartWidth} y2={y} className="chart-grid" />
              <text x={padding.left - 10} y={y + 4} textAnchor="end" className="chart-label">
                {formatCount(Math.round(maxDownloads * tick))}
              </text>
            </g>
          );
        })}
        {areaPath ? <path d={areaPath} className="line-chart-area" /> : null}
        <path d={smoothPath(points)} className="line-chart-path" />
        {labelIndexes.map((index) => {
          const row = rows[index];
          const point = points[index];

          if (!row || !point) {
            return null;
          }

          return (
            <text key={`${row.activityDate}-label`} x={point.x} y={height - 8} textAnchor="middle" className="chart-label">
              {formatCompactDate(row.activityDate)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function TopEpisodeBars({ rows }: { rows: PodcastStatsDashboard["topEpisodes"] }) {
  const maxDownloads = Math.max(...rows.map((row) => row.totalDownloads), 1);

  return (
    <div className="bar-chart-list">
      {rows.map((row, index) => (
        <Link key={row.trackId} href={`/podcast/episodes?trackId=${row.trackId}`} className="bar-chart-row">
          <span>{index + 1}</span>
          <strong>{row.episodeTitle || row.podtracEpisodeTitle}</strong>
          <div className="bar-chart-row__bar" aria-hidden="true">
            <i style={{ width: `${Math.max(3, Math.round((row.totalDownloads / maxDownloads) * 100))}%` }} />
          </div>
          <em>{formatCount(row.totalDownloads)}</em>
        </Link>
      ))}
    </div>
  );
}

function CountryPie({ rows }: { rows: PodcastStatsDashboard["countryDownloads"] }) {
  const total = rows.reduce((sum, row) => sum + row.downloads, 0);
  let cursor = 0;
  const segments = rows.map((row, index) => {
    const start = cursor;
    const share = total > 0 ? (row.downloads / total) * 100 : 0;
    cursor += share;
    return `${chartColors[index % chartColors.length]} ${start}% ${cursor}%`;
  });

  return (
    <div className="pie-chart-layout">
      <div
        className="pie-chart"
        role="img"
        aria-label="Top countries by downloads"
        style={{ background: total > 0 ? `conic-gradient(${segments.join(", ")})` : "var(--parchment-warm)" }}
      />
      <div className="pie-legend">
        {rows.map((row, index) => (
          <span key={row.country}>
            <i style={{ background: chartColors[index % chartColors.length] }} />
            <strong>{row.country}</strong>
            {formatCount(row.downloads)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default async function PodcastStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; countryRange?: string }>;
}) {
  const params = await searchParams;
  const range = parsePodtracRange(params.range);
  const countryRange = parsePodtracRange(params.countryRange ?? params.range);
  const [dashboard, countryDashboard] = await Promise.all([
    getPodcastStatsDashboard(range),
    countryRange === range ? Promise.resolve(null) : getPodcastStatsDashboard(countryRange),
  ]);
  const isAdministrator = await isCurrentUserAdministrator();
  const countryRows = countryDashboard?.countryDownloads ?? dashboard.countryDownloads;

  return (
    <>
      <TopRail variant="public" />
      <main className="public-shell">
        <RoutePanel
          eyebrow="Podcast"
          title="Podcast statistics"
        >
          <div className="podcast-subnav" aria-label="Podcast report navigation">
            <span>
              <strong>Indexed Podtrac window</strong>
              <small>
                {formatDate(dashboard.range.minDate)} through {formatDate(dashboard.range.maxDate)}
              </small>
            </span>
            <Link className="button button--ghost" href="/podcast/episodes">
              Episode Statistics
            </Link>
            {isAdministrator ? (
              <Link className="button button--ghost" href="/overview">
                Administrative Health Dashboard
              </Link>
            ) : null}
          </div>

          <section className="signal-board stats-hero">
            <div>
              <p className="eyebrow">{dashboard.range.label}</p>
              <h2>{formatCount(dashboard.counts.rangeDownloads)} downloads</h2>
              <p>
                Daily Podtrac activity from {formatDate(dashboard.range.startDate)} through {formatDate(dashboard.range.endDate)}.
                Imported history total is {formatCount(dashboard.counts.allTimeDownloads)} downloads.
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
            </div>
          </section>

          <section className="podcast-chart-section">
            <div className="chart-section-head">
              <div>
                <p className="eyebrow">Downloads by day</p>
                <h2>Daily activity</h2>
              </div>
              <RangeForm name="range" value={dashboard.range.key} label="Timeframe" hidden={{ countryRange }} />
            </div>
            <LineChart rows={dashboard.dailyTrend} />
          </section>

          <section className="split-board split-board--wide">
            <div>
              <p className="eyebrow">Imported history</p>
              <h2>Top 15 episodes</h2>
              <TopEpisodeBars rows={dashboard.topEpisodes} />
            </div>
            <div>
              <div className="chart-section-head chart-section-head--compact">
                <div>
                  <p className="eyebrow">{countryDashboard?.range.label ?? dashboard.range.label}</p>
                  <h2>Top countries</h2>
                </div>
                <RangeForm name="countryRange" value={countryRange} label="Countries" hidden={{ range }} />
              </div>
              <CountryPie rows={countryRows} />
            </div>
          </section>
        </RoutePanel>
      </main>
    </>
  );
}
