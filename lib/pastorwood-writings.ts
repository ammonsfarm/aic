import "server-only";

import { queryRows } from "@/lib/db";
import { embedQuery, type EpisodeChatSource } from "@/lib/podcast-data";

type WritingSearchRow = {
  post_id: string;
  source_type: string;
  title: string;
  publish_date: string | null;
  source_url: string;
  slug: string;
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

type WritingDetailRow = {
  post_id: string;
  source_type: string;
  title: string;
  slug: string;
  source_url: string;
  publish_date: string | null;
  excerpt_html: string;
  content_html: string;
  text: string;
  chunk_count: string;
  embedded_chunk_count: string;
};

type WritingChunkRow = {
  source_type: string;
  track_id: string;
  title: string;
  publish_date: string;
  custom_id: string;
  text: string;
  score: number;
  source_model: string | null;
  source_url: string | null;
};

export type PastorWoodWriting = {
  postId: string;
  sourceType: string;
  sourceLabel: string;
  title: string;
  publishDate: string;
  sourceUrl: string;
  slug: string;
  localPath: string;
  snippet: string;
  score: number;
};

export type PastorWoodWritingDetail = PastorWoodWriting & {
  contentHtml: string;
  text: string;
  summary: string;
  paragraphs: string[];
  chunkCount: number;
  embeddedChunkCount: number;
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

function writingSourceTypeForRag(sourceType: string) {
  if (sourceType === "pastorwood_devotional") {
    return "pastorwood.devotional";
  }

  if (sourceType === "pastorwood_resource") {
    return "pastorwood.resource";
  }

  return sourceType.replace(/^pastorwood_/, "pastorwood.").replace(/_/g, ".");
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

function splitParagraphs(value: string) {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function trimToSentence(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const slice = normalized.slice(0, maxLength + 1);
  const sentenceEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("? "), slice.lastIndexOf("! "));
  if (sentenceEnd > Math.floor(maxLength * 0.45)) {
    return slice.slice(0, sentenceEnd + 1).trim();
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function buildSummary(text: string) {
  const paragraphs = splitParagraphs(text);
  const lead = paragraphs.slice(0, 2).join(" ");
  return trimToSentence(lead || text, 680);
}

function localWritingPath(slug: string, postId: string) {
  const safeSlug = slug.trim() || postId;
  return `/writings/${encodeURIComponent(safeSlug)}`;
}

function toWriting(row: WritingSearchRow): PastorWoodWriting {
  return {
    postId: row.post_id,
    sourceType: row.source_type,
    sourceLabel: writingSourceLabel(row.source_type),
    title: row.title,
    publishDate: row.publish_date ?? "",
    sourceUrl: row.source_url,
    slug: row.slug,
    localPath: localWritingPath(row.slug, row.post_id),
    snippet: cleanSnippet(row.snippet),
    score: toNumber(row.score),
  };
}

function toChatSource(row: WritingChunkRow): EpisodeChatSource {
  return {
    sourceType: writingSourceTypeForRag(row.source_type),
    trackId: row.track_id,
    title: row.title,
    publishDate: row.publish_date,
    segmentId: row.custom_id,
    text: row.text,
    startTime: "",
    endTime: "",
    speakers: [],
    score: Number(row.score),
    vectorModel: row.source_model ?? "",
    sourceUrl: row.source_url ?? "",
  };
}

function dedupeSources(rows: WritingChunkRow[]) {
  const seen = new Set<string>();
  const deduped: WritingChunkRow[] = [];

  for (const row of rows) {
    if (seen.has(row.custom_id)) {
      continue;
    }
    seen.add(row.custom_id);
    deduped.push(row);
  }

  return deduped;
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
          p.slug,
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
    rows: searchRows.map(toWriting),
  };
}

export async function getPastorWoodWritingBySlug(slugOrPostId: string): Promise<PastorWoodWritingDetail | null> {
  const normalized = slugOrPostId.trim();
  if (!normalized) {
    return null;
  }

  const rows = await queryRows<WritingDetailRow>(
    `
      select
        p.post_id::text,
        p.source_type,
        p.title,
        p.slug,
        p.source_url,
        p.publish_date::text,
        p.excerpt_html,
        p.content_html,
        p.text,
        count(pc.custom_id)::text as chunk_count,
        count(pc.custom_id) filter (where pc.embedding is not null)::text as embedded_chunk_count
      from pastorwood_posts p
      left join pastorwood_post_chunks pc on pc.post_id = p.post_id
      where p.slug = $1
         or p.post_id::text = $1
      group by
        p.post_id,
        p.source_type,
        p.title,
        p.slug,
        p.source_url,
        p.publish_date,
        p.excerpt_html,
        p.content_html,
        p.text
      limit 1
    `,
    [normalized],
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  const base = toWriting({
    post_id: row.post_id,
    source_type: row.source_type,
    title: row.title,
    publish_date: row.publish_date,
    source_url: row.source_url,
    slug: row.slug,
    snippet: row.text.slice(0, 420),
    score: "0",
  });

  return {
    ...base,
    contentHtml: row.content_html,
    text: row.text,
    summary: buildSummary(row.text),
    paragraphs: splitParagraphs(row.text),
    chunkCount: toNumber(row.chunk_count),
    embeddedChunkCount: toNumber(row.embedded_chunk_count),
  };
}

export async function getPastorWoodWritingRagSources({
  postId,
  query,
  topK = 8,
}: {
  postId: string;
  query: string;
  topK?: number;
}): Promise<EpisodeChatSource[]> {
  const normalizedPostId = postId.trim();
  const question = query.trim();
  const boundedTopK = Math.max(2, Math.min(Math.trunc(topK), 16));

  if (!normalizedPostId || !question) {
    return [];
  }

  const orientationRowsPromise = queryRows<WritingChunkRow>(
    `
      select
        pc.source_type,
        'pastorwood:' || pc.post_id::text as track_id,
        pc.title,
        coalesce(pc.publish_date, '') as publish_date,
        pc.custom_id,
        pc.text,
        0.64 as score,
        coalesce(nullif(pc.embedding_model, ''), 'opening context') as source_model,
        pc.source_url
      from pastorwood_post_chunks pc
      where pc.post_id::text = $1
      order by pc.chunk_index asc
      limit 2
    `,
    [normalizedPostId],
  );

  const textRowsPromise = queryRows<WritingChunkRow>(
    `
      with q as (
        select websearch_to_tsquery('english', $2) as query_ts
      )
      select
        pc.source_type,
        'pastorwood:' || pc.post_id::text as track_id,
        pc.title,
        coalesce(pc.publish_date, '') as publish_date,
        pc.custom_id,
        pc.text,
        greatest(coalesce(ts_rank_cd(pc.search_tsv, q.query_ts), 0), 0.45) as score,
        coalesce(nullif(pc.embedding_model, ''), 'text search') as source_model,
        pc.source_url
      from pastorwood_post_chunks pc
      cross join q
      where pc.post_id::text = $1
        and (
          q.query_ts @@ pc.search_tsv
          or lower(pc.text) like ('%' || lower($2) || '%')
        )
      order by score desc, pc.chunk_index asc
      limit $3
    `,
    [normalizedPostId, question, boundedTopK],
  );

  let vectorRows: WritingChunkRow[] = [];
  try {
    const embedding = await embedQuery(question);
    vectorRows = await queryRows<WritingChunkRow>(
      `
        select
          pc.source_type,
          'pastorwood:' || pc.post_id::text as track_id,
          pc.title,
          coalesce(pc.publish_date, '') as publish_date,
          pc.custom_id,
          pc.text,
          coalesce(1 - (pc.embedding <=> $2::vector), 0) as score,
          coalesce(pc.embedding_model, '') as source_model,
          pc.source_url
        from pastorwood_post_chunks pc
        where pc.post_id::text = $1
          and pc.embedding is not null
        order by score desc, pc.chunk_index asc
        limit $3
      `,
      [normalizedPostId, `[${embedding.join(",")}]`, boundedTopK],
    );
  } catch (error) {
    console.warn("Pastor Wood writing vector retrieval degraded to text search", error);
  }

  const [orientationRows, textRows] = await Promise.all([orientationRowsPromise, textRowsPromise]);
  return dedupeSources([...orientationRows, ...vectorRows.filter((row) => Number(row.score) > 0.15), ...textRows])
    .slice(0, boundedTopK)
    .map(toChatSource);
}
