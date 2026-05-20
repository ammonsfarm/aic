import "server-only";

import { queryRows } from "@/lib/db";
import { searchEpisodesByText, type EpisodeSearchItem, type EpisodeSearchScope } from "@/lib/podcast-data";

type EpisodeBaseRow = {
  track_id: string;
  title: string;
  publish_date: string;
  album: string;
  category: string;
  detail: string;
  source_file: string;
  has_transcript: boolean;
  has_intelligence: boolean;
  has_vectors: boolean;
  has_podtrac: boolean;
};

type PipelineRunRow = {
  source: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error: string;
};

type SourceTypeCountRow = {
  item_type: string;
  count: string;
};

type TranscriptSampleRow = {
  track_id: string;
  title: string;
  publish_date: string;
  custom_id: string;
  start_time: string;
  end_time: string;
  segment_type: string;
  text: string;
};

type IntelligenceItemSampleRow = {
  id: string;
  track_id: string;
  item_type: string;
  label: string;
  summary: string;
  title: string;
  publish_date: string;
};

type IntelligenceVectorSampleRow = {
  custom_id: string;
  track_id: string;
  vector_type: string;
  title: string;
  publish_date: string;
  label: string;
  text: string;
};

export type PipelineRun = {
  source: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  error: string;
};

export type SourceBrowserData = {
  intelligenceItemTypes: Array<{ type: string; count: number }>;
  recentTranscriptSamples: Array<{
    trackId: string;
    title: string;
    publishDate: string;
    customId: string;
    startTime: string;
    endTime: string;
    segmentType: string;
    text: string;
  }>;
  recentIntelligenceItemSamples: Array<{
    id: string;
    trackId: string;
    title: string;
    publishDate: string;
    itemType: string;
    label: string;
    summary: string;
  }>;
  recentIntelligenceVectorSamples: Array<{
    customId: string;
    trackId: string;
    title: string;
    publishDate: string;
    vectorType: string;
    label: string;
    text: string;
  }>;
};

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSearchRow(row: EpisodeBaseRow): EpisodeSearchItem {
  return {
    trackId: row.track_id,
    title: row.title,
    publishDate: row.publish_date,
    album: row.album,
    category: row.category,
    detail: row.detail,
    sourceFile: row.source_file,
    hasTranscript: row.has_transcript,
    hasIntelligence: row.has_intelligence,
    hasVectors: row.has_vectors,
    hasPodtrac: row.has_podtrac,
    score: 0,
    hitTypes: ["catalog"],
    snippet: "",
  };
}

function trimText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

export async function getEpisodeArchiveRows({
  query,
  limit = 240,
  scope,
}: {
  query?: string;
  limit?: number;
  scope?: EpisodeSearchScope;
} = {}): Promise<EpisodeSearchItem[]> {
  const normalizedQuery = query?.trim();

  if (!normalizedQuery) {
    const rows = await queryRows<EpisodeBaseRow>(
      `
        select
          e.track_id,
          e.title,
          e.publish_date,
          e.album,
          e.category,
          e.detail,
          e.source_file,
          exists(select 1 from transcript_chunks tc where tc.track_id = e.track_id) as has_transcript,
          exists(select 1 from episode_intelligence ei where ei.track_id = e.track_id) as has_intelligence,
          exists(
            select 1
            from episode_intelligence_vectors v
            where v.track_id = e.track_id
              and v.embedding is not null
          )
          or exists(select 1 from transcript_chunks tc2 where tc2.track_id = e.track_id and tc2.embedding is not null) as has_vectors,
          exists(
            select 1
            from podtrac_episodes pe
            where pe.track_id = e.track_id
              and pe.track_id is not null
          ) as has_podtrac
        from episodes e
        order by nullif(e.publish_date, '')::date desc nulls last, e.title asc
        limit $1
      `,
      [limit],
    );

    return rows.map(normalizeSearchRow);
  }

    return searchEpisodesByText(normalizedQuery, { limit, scope });
  }

export async function getPipelineRuns(limit = 10): Promise<PipelineRun[]> {
  const rows = await queryRows<PipelineRunRow>(
    `
      select 'corpus-sync'::text as source, status, started_at::text, completed_at::text, error
      from sync_runs
      union all
      select 'podtrac-sync'::text as source, status, started_at::text, completed_at::text, error
      from podtrac_sync_runs
      order by coalesce(completed_at::text, started_at::text) desc
      limit $1
    `,
    [limit],
  );

  return rows.map((row) => ({
    source: row.source,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
  }));
}

export async function getSourceBrowserData(limit = 12): Promise<SourceBrowserData> {
  const [intelligenceItemTypeRows, transcriptRows, itemRows, vectorRows] = await Promise.all([
    queryRows<SourceTypeCountRow>(`
      select item_type, count(*)::text as count
      from episode_intelligence_items
      group by item_type
      order by count(*) desc
    `),
    queryRows<TranscriptSampleRow>(
      `
        select
          tc.track_id,
          e.title,
          e.publish_date,
          tc.custom_id,
          tc.start_time,
          tc.end_time,
          tc.segment_type,
          tc.text
        from transcript_chunks tc
        join episodes e on e.track_id = tc.track_id
        order by tc.updated_at desc
        limit $1
      `,
      [limit],
    ),
    queryRows<IntelligenceItemSampleRow>(
      `
        select i.id, i.track_id, i.item_type, i.label, i.summary, e.title, e.publish_date
        from episode_intelligence_items i
        join episodes e on e.track_id = i.track_id
        order by i.id desc
        limit $1
      `,
      [limit],
    ),
    queryRows<IntelligenceVectorSampleRow>(
      `
        select
          iv.custom_id,
          iv.track_id,
          iv.vector_type,
          e.title,
          e.publish_date,
          iv.label,
          iv.text
        from episode_intelligence_vectors iv
        join episodes e on e.track_id = iv.track_id
        order by iv.updated_at desc
        limit $1
      `,
      [limit],
    ),
  ]);

  return {
    intelligenceItemTypes: intelligenceItemTypeRows
      .map((row) => ({ type: row.item_type, count: toNumber(row.count) }))
      .filter((row) => row.type),
    recentTranscriptSamples: transcriptRows.map((row) => ({
      trackId: row.track_id,
      title: row.title,
      publishDate: row.publish_date,
      customId: row.custom_id,
      startTime: row.start_time,
      endTime: row.end_time,
      segmentType: row.segment_type,
      text: trimText(row.text, 260),
    })),
    recentIntelligenceItemSamples: itemRows.map((row) => ({
      id: row.id,
      trackId: row.track_id,
      title: row.title,
      publishDate: row.publish_date,
      itemType: row.item_type,
      label: row.label,
      summary: trimText(row.summary, 220),
    })),
    recentIntelligenceVectorSamples: vectorRows.map((row) => ({
      customId: row.custom_id,
      trackId: row.track_id,
      title: row.title,
      publishDate: row.publish_date,
      vectorType: row.vector_type,
      label: row.label,
      text: trimText(row.text, 220),
    })),
  };
}
