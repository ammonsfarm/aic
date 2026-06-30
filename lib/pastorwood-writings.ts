import "server-only";

import { queryRows } from "@/lib/db";

type WritingSearchRow = {
  post_id: string;
  source_type: string;
  title: string;
  publish_date: string | null;
  source_url: string;
  snippet: string;
  score: string;
};

type WritingSummaryRow = {
  source_type: string;
  post_count: string;
  chunk_count: string;
  embedded_chunk_count: string;
  first_date: string | null;
  last_date: string | null;
};

export type PastorWoodWriting = {
  postId: string;
  sourceType: string;
  sourceLabel: string;
  title: string;
  publishDate: string;
  sourceUrl: string;
  snippet: string;
  score: number;
};

export type PastorWoodWritingsSummary = {
  sourceType: string;
  sourceLabel: string;
  postCount: number;
  chunkCount: number;
  embeddedChunkCount: number;
  firstDate: string;
  lastDate: string;
};

export type PastorWoodWritingsResult = {
  query: string;
  rows: PastorWoodWriting[];
  summaries: PastorWoodWritingsSummary[];
};

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function writingSourceLabel(sourceType: string) {
  if (sourceType === "pastorwood_devotional") {
    return "Weekly devotional";
  }

  if (sourceType === "pastorwood_resource") {
    return "Resource";
  }

  if (sourceType === "pastorwood_book") {
    return "Book";
  }

  return sourceType.replace(/^pastorwood_/, "").replace(/_/g, " ");
}

function normalizeQuery(value: string | undefined) {
  return value?.trim().replace(/\s+/g, " ").slice(0, 180) ?? "";
}

function cleanSnippet(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function getPastorWoodWritings({
  query,
  limit = 24,
}: {
  query?: string;
  limit?: number;
}): Promise<PastorWoodWritingsResult> {
  const normalizedQuery = normalizeQuery(query);
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 80));

  const [summaryRows, searchRows] = await Promise.all([
    queryRows<WritingSummaryRow>(
      `
        select
          p.source_type,
          count(distinct p.post_id)::text as post_count,
          count(pc.custom_id)::text as chunk_count,
          count(pc.custom_id) filter (where pc.embedding is not null)::text as embedded_chunk_count,
          min(p.publish_date)::text as first_date,
          max(p.publish_date)::text as last_date
        from pastorwood_posts p
        left join pastorwood_post_chunks pc on pc.post_id = p.post_id
        group by p.source_type
        order by p.source_type
      `,
    ),
    queryRows<WritingSearchRow>(
      `
        with q as (
          select
            nullif($1::text, '') as raw_query,
            case
              when nullif($1::text, '') is null then null
              else websearch_to_tsquery('english', $1::text)
            end as query_ts
        )
        select
          p.post_id::text,
          p.source_type,
          p.title,
          p.publish_date::text,
          p.source_url,
          case
            when q.query_ts is null then left(p.text, 420)
            else regexp_replace(
              coalesce(
                ts_headline('english', p.text, q.query_ts, 'MaxWords=46, MinWords=18, ShortWord=3'),
                left(p.text, 420)
              ),
              '<[^>]+>',
              '',
              'g'
            )
          end as snippet,
          case
            when q.query_ts is null then 0
            else greatest(
              coalesce(ts_rank_cd(p.search_tsv, q.query_ts), 0),
              case
                when lower(p.title) like ('%' || lower(q.raw_query) || '%') then 0.12
                when lower(p.text) like ('%' || lower(q.raw_query) || '%') then 0.04
                else 0
              end
            )
          end::text as score
        from pastorwood_posts p
        cross join q
        where q.raw_query is null
           or q.query_ts @@ p.search_tsv
           or lower(p.title) like ('%' || lower(q.raw_query) || '%')
           or lower(p.text) like ('%' || lower(q.raw_query) || '%')
        order by
          case when q.query_ts is null then p.publish_date end desc nulls last,
          case when q.query_ts is not null then
            greatest(
              coalesce(ts_rank_cd(p.search_tsv, q.query_ts), 0),
              case
                when lower(p.title) like ('%' || lower(q.raw_query) || '%') then 0.12
                when lower(p.text) like ('%' || lower(q.raw_query) || '%') then 0.04
                else 0
              end
            )
          end desc nulls last,
          p.publish_date desc nulls last,
          p.title asc
        limit $2
      `,
      [normalizedQuery, boundedLimit],
    ),
  ]);

  return {
    query: normalizedQuery,
    summaries: summaryRows.map((row) => ({
      sourceType: row.source_type,
      sourceLabel: writingSourceLabel(row.source_type),
      postCount: toNumber(row.post_count),
      chunkCount: toNumber(row.chunk_count),
      embeddedChunkCount: toNumber(row.embedded_chunk_count),
      firstDate: row.first_date ?? "",
      lastDate: row.last_date ?? "",
    })),
    rows: searchRows.map((row) => ({
      postId: row.post_id,
      sourceType: row.source_type,
      sourceLabel: writingSourceLabel(row.source_type),
      title: row.title,
      publishDate: row.publish_date ?? "",
      sourceUrl: row.source_url,
      snippet: cleanSnippet(row.snippet),
      score: toNumber(row.score),
    })),
  };
}
