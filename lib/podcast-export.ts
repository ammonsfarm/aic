import "server-only";

import { queryRows } from "@/lib/db";
import { normalizeReportDate, rowsToCsv, utcToday } from "@/lib/podcast-reporting";

export const podcastExportReports = ["daily", "episodes", "unmatched", "pipeline", "transcript-edits"] as const;
export type PodcastExportReport = (typeof podcastExportReports)[number];

export function parsePodcastExportReport(value: unknown): PodcastExportReport | null {
  return typeof value === "string" && podcastExportReports.includes(value as PodcastExportReport)
    ? (value as PodcastExportReport)
    : null;
}

export function normalizeExportRange(startDate?: string | null, endDate?: string | null, today = utcToday()) {
  const start = normalizeReportDate(startDate);
  const end = normalizeReportDate(endDate);
  if (!start || !end || start > end || end > today) {
    throw new Error("Choose a valid export date range that ends no later than today.");
  }
  return { startDate: start, endDate: end };
}

export async function buildPodcastCsvReport({
  report,
  startDate,
  endDate,
}: {
  report: PodcastExportReport;
  startDate: string;
  endDate: string;
}) {
  const range = normalizeExportRange(startDate, endDate);

  if (report === "daily") {
    const rows = await queryRows<{ activity_date: string; downloads: string }>(
      `select activity_date::text, sum(download_count)::text as downloads
         from podtrac_daily_activity
        where activity_date between $1::date and $2::date
        group by activity_date
        order by activity_date`,
      [range.startDate, range.endDate],
    );
    return rowsToCsv(["activity_date", "downloads"], rows.map((row) => [row.activity_date, row.downloads]));
  }

  if (report === "episodes") {
    const rows = await queryRows<{
      track_id: string;
      title: string;
      publish_date: string;
      downloads: string;
      last_activity_date: string | null;
    }>(
      `select e.track_id, e.title, e.publish_date,
              coalesce(sum(pda.download_count), 0)::text as downloads,
              max(pda.activity_date)::text as last_activity_date
         from episodes e
         join podtrac_episodes pe on pe.track_id = e.track_id
         left join podtrac_daily_activity pda
           on pda.podtrac_episode_id = pe.podtrac_episode_id
          and pda.activity_date between $1::date and $2::date
        group by e.track_id, e.title, e.publish_date
        order by sum(pda.download_count) desc nulls last, e.publish_date desc`,
      [range.startDate, range.endDate],
    );
    return rowsToCsv(
      ["track_id", "title", "publish_date", "range_downloads", "last_activity_date"],
      rows.map((row) => [row.track_id, row.title, row.publish_date, row.downloads, row.last_activity_date]),
    );
  }

  if (report === "unmatched") {
    const rows = await queryRows<{
      podtrac_episode_id: string;
      title: string;
      publish_date: string | null;
      match_status: string;
      match_notes: string;
      updated_at: string;
    }>(
      `select podtrac_episode_id, title, publish_date::text, match_status, match_notes, updated_at::text
         from podtrac_episodes
        where track_id is null or match_status = 'unmatched'
        order by publish_date desc nulls last, title`,
    );
    return rowsToCsv(
      ["podtrac_episode_id", "title", "publish_date", "match_status", "match_notes", "updated_at"],
      rows.map((row) => [
        row.podtrac_episode_id,
        row.title,
        row.publish_date,
        row.match_status,
        row.match_notes,
        row.updated_at,
      ]),
    );
  }

  if (report === "pipeline") {
    const rows = await queryRows<{
      run_id: string;
      stage: string;
      status: string;
      started_at: string;
      completed_at: string | null;
      error: string;
    }>(
      `select run_id, stage, status, started_at, completed_at, error
         from ingest_runs
        where started_at::timestamptz::date between $1::date and $2::date
        order by started_at::timestamptz desc`,
      [range.startDate, range.endDate],
    );
    return rowsToCsv(
      ["run_id", "stage", "status", "started_at", "completed_at", "error"],
      rows.map((row) => [row.run_id, row.stage, row.status, row.started_at, row.completed_at, row.error]),
    );
  }

  const rows = await queryRows<{
    id: string;
    track_id: string;
    status: string;
    edited_by: string;
    created_at: string;
    updated_at: string;
    applied_at: string | null;
    processing_error: string;
  }>(
    `select id::text, track_id, status, edited_by, created_at::text, updated_at::text,
            applied_at::text, processing_error
       from transcript_edit_requests
      where created_at::date between $1::date and $2::date
      order by created_at desc`,
    [range.startDate, range.endDate],
  );
  return rowsToCsv(
    ["id", "track_id", "status", "edited_by", "created_at", "updated_at", "applied_at", "processing_error"],
    rows.map((row) => [
      row.id,
      row.track_id,
      row.status,
      row.edited_by,
      row.created_at,
      row.updated_at,
      row.applied_at,
      row.processing_error,
    ]),
  );
}
