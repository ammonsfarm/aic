import "server-only";
import { MissingDatabaseEnvError, queryRows } from "@/lib/db";

type CountRow = {
  episodes_count: string;
  transcript_chunks_count: string;
  transcript_episode_count: string;
  speech_vector_count: string;
  intelligence_count: string;
  intelligence_items_count: string;
  intelligence_vector_count: string;
  podtrac_episode_count: string;
  podtrac_matched_count: string;
  podtrac_unmatched_count: string;
  podtrac_daily_rows: string;
  podtrac_country_rows: string;
  podtrac_client_rows: string;
  podtrac_clean_downloads: string | null;
};

type StatusRow = {
  status: string;
  count: string;
};

type RecentEpisodeRow = {
  track_id: string;
  title: string;
  publish_date: string;
  has_transcript: boolean;
  has_intelligence: boolean;
  podtrac_match_status: string | null;
};

type SyncRunRow = {
  source: string;
  status: string;
  completed_at: string | null;
  error: string;
};

export type OverviewData = {
  counts: {
    episodes: number;
    transcriptChunks: number;
    transcriptEpisodes: number;
    speechVectors: number;
    intelligence: number;
    intelligenceItems: number;
    intelligenceVectors: number;
    podtracEpisodes: number;
    podtracMatched: number;
    podtracUnmatched: number;
    podtracDailyRows: number;
    podtracCountryRows: number;
    podtracClientRows: number;
    cleanWindowDownloads: number;
  };
  intelligenceStatus: { status: string; count: number }[];
  recentEpisodes: RecentEpisodeRow[];
  latestSyncRuns: SyncRunRow[];
};

export type OverviewResult =
  | { ok: true; data: OverviewData }
  | { ok: false; type: "missing-env"; missing: string[] }
  | { ok: false; type: "database-error"; message: string };

const cleanWindowStart = "2026-02-01";
const cleanWindowEnd = "2026-04-30";

function toNumber(value: string | null | undefined) {
  return Number(value ?? 0);
}

export async function getOverviewData(): Promise<OverviewResult> {
  try {
    const [countRows, statusRows, recentEpisodes, latestSyncRuns] = await Promise.all([
      queryRows<CountRow>(
        `
          select
            (select count(*) from episodes) as episodes_count,
            (select count(*) from transcript_chunks) as transcript_chunks_count,
            (select count(distinct track_id) from transcript_chunks) as transcript_episode_count,
            (select count(*) from transcript_chunks where embedding is not null) as speech_vector_count,
            (select count(*) from episode_intelligence) as intelligence_count,
            (select count(*) from episode_intelligence_items) as intelligence_items_count,
            (select count(*) from episode_intelligence_vectors where embedding is not null) as intelligence_vector_count,
            (select count(*) from podtrac_episodes) as podtrac_episode_count,
            (select count(*) from podtrac_episodes where track_id is not null) as podtrac_matched_count,
            (select count(*) from podtrac_episodes where track_id is null or match_status = 'unmatched') as podtrac_unmatched_count,
            (select count(*) from podtrac_daily_activity) as podtrac_daily_rows,
            (select count(*) from podtrac_activity_by_country) as podtrac_country_rows,
            (select count(*) from podtrac_activity_by_client) as podtrac_client_rows,
            (
              select coalesce(sum(download_count), 0)
              from podtrac_daily_activity
              where activity_date between $1::date and $2::date
            ) as podtrac_clean_downloads
        `,
        [cleanWindowStart, cleanWindowEnd],
      ),
      queryRows<StatusRow>(
        `
          select coalesce(nullif(status, ''), 'unknown') as status, count(*) as count
          from episode_intelligence
          group by 1
          order by count(*) desc, status asc
        `,
      ),
      queryRows<RecentEpisodeRow>(
        `
          select
            e.track_id,
            e.title,
            e.publish_date,
            exists(select 1 from transcript_chunks tc where tc.track_id = e.track_id) as has_transcript,
            exists(select 1 from episode_intelligence ei where ei.track_id = e.track_id) as has_intelligence,
            pe.match_status as podtrac_match_status
          from episodes e
          left join podtrac_episodes pe on pe.track_id = e.track_id
          order by nullif(e.publish_date, '')::date desc nulls last, e.title asc
          limit 6
        `,
      ),
      queryRows<SyncRunRow>(
        `
          select 'corpus'::text as source, status, completed_at::text, error
          from sync_runs
          union all
          select 'podtrac'::text as source, status, completed_at::text, error
          from podtrac_sync_runs
          order by completed_at desc nulls last
          limit 4
        `,
      ),
    ]);

    const counts = countRows[0];

    return {
      ok: true,
      data: {
        counts: {
          episodes: toNumber(counts.episodes_count),
          transcriptChunks: toNumber(counts.transcript_chunks_count),
          transcriptEpisodes: toNumber(counts.transcript_episode_count),
          speechVectors: toNumber(counts.speech_vector_count),
          intelligence: toNumber(counts.intelligence_count),
          intelligenceItems: toNumber(counts.intelligence_items_count),
          intelligenceVectors: toNumber(counts.intelligence_vector_count),
          podtracEpisodes: toNumber(counts.podtrac_episode_count),
          podtracMatched: toNumber(counts.podtrac_matched_count),
          podtracUnmatched: toNumber(counts.podtrac_unmatched_count),
          podtracDailyRows: toNumber(counts.podtrac_daily_rows),
          podtracCountryRows: toNumber(counts.podtrac_country_rows),
          podtracClientRows: toNumber(counts.podtrac_client_rows),
          cleanWindowDownloads: toNumber(counts.podtrac_clean_downloads),
        },
        intelligenceStatus: statusRows.map((row) => ({ status: row.status, count: toNumber(row.count) })),
        recentEpisodes,
        latestSyncRuns,
      },
    };
  } catch (error) {
    if (error instanceof MissingDatabaseEnvError) {
      return { ok: false, type: "missing-env", missing: error.missing };
    }

    return {
      ok: false,
      type: "database-error",
      message: error instanceof Error ? error.message : "Unknown database error",
    };
  }
}
