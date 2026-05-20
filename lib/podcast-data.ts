import "server-only";
import { queryRows } from "@/lib/db";

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

type TextSearchMatchRow = {
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
  hit_source: string;
  score: string;
  snippet: string;
};

type EpisodeDetailRow = {
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

type EpisodeIntelligenceRow = {
  track_id: string;
  title: string;
  publish_date: string;
  episode_type: string;
  executive_summary: string;
  long_summary: string;
  main_topics: unknown;
  search_keywords: unknown;
  raw_json: unknown;
  source_model: string;
  status: string;
  error: string;
  input_chars: number;
  transcript_truncated: boolean;
};

type TranscriptChunkRow = {
  custom_id: string;
  track_id: string;
  title: string;
  start_time: string;
  end_time: string;
  speakers: unknown;
  segment_type: string;
  text: string;
};

type TranscriptSegmentRow = {
  segment_id: string;
  track_id: string;
  segment_index: number;
  start_time: string;
  end_time: string;
  start_seconds: number | null;
  end_seconds: number | null;
  speaker_id: string;
  speaker_name: string;
  segment_type: string;
  text: string;
  bible_references: unknown;
  other_references: unknown;
};

type TranscriptReferenceRow = {
  reference_id: string;
  track_id: string;
  segment_index: number | null;
  reference_type: string;
  source_scope: string;
  reference: string;
  start_time: string;
  end_time: string;
  start_seconds: number | null;
  end_seconds: number | null;
  context: string;
  text: string;
  raw_reference: unknown;
};

type IntelligenceItemRow = {
  id: string;
  item_type: string;
  label: string;
  summary: string;
  source_times: unknown;
  speakers: unknown;
  confidence: string;
  value_json: unknown;
};

type PodtracEpisodeRow = {
  podtrac_episode_id: string;
  title: string;
  publish_date: string | null;
  match_status: string;
  total_downloads: string;
  last_activity_date: string | null;
};

type PodtracDailyActivityRow = {
  activity_date: string;
  download_count: number;
};

type DashboardRow = {
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
  podtrac_total_downloads: string;
};

type RAGVectorHitRow = {
  source_type: string;
  track_id: string;
  title: string;
  publish_date: string;
  custom_id: string;
  text: string;
  start_time: string | null;
  end_time: string | null;
  speakers: unknown;
  score: number;
  source_model: string | null;
};

type EpisodeSummarySourceRow = {
  track_id: string;
  title: string;
  publish_date: string;
  executive_summary: string;
  long_summary: string;
  source_model: string;
};

type CountryRow = {
  name: string;
  downloads: string;
};

type VectorSearchTrackRow = {
  source_type: string;
  track_id: string;
  title: string;
  publish_date: string;
  custom_id: string;
  text: string;
  start_time: string;
  end_time: string;
  speakers: unknown;
  score: number;
  source_model: string;
};

type SearchOptions = {
  limit?: number;
  trackId?: string;
  includeVector?: boolean;
  scope?: EpisodeSearchScope;
};

export type EpisodeSearchScope = "all" | "title" | "passage" | "guest" | "interview" | "theme";

type TopEpisodeRow = {
  track_id: string;
  title: string;
  publish_date: string;
  podtrac_title: string;
  match_status: string;
  downloads: string;
};

type TrendRow = {
  activity_date: string;
  downloads: string;
};

type SpeakerField = {
  name: string;
};

export type SpeakerList = {
  names: string[];
};

export type EpisodeSearchItem = {
  trackId: string;
  title: string;
  publishDate: string;
  album: string;
  category: string;
  detail: string;
  sourceFile: string;
  hasTranscript: boolean;
  hasIntelligence: boolean;
  hasVectors: boolean;
  hasPodtrac: boolean;
  score: number;
  hitTypes: string[];
  snippet: string;
};

export type EpisodeDetail = {
  episode: {
    trackId: string;
    title: string;
    publishDate: string;
    album: string;
    category: string;
    detail: string;
    sourceFile: string;
    hasTranscript: boolean;
    hasIntelligence: boolean;
    hasVectors: boolean;
    hasPodtrac: boolean;
    audioUrl: string;
  };
  intelligence: {
    episodeType: string;
    executiveSummary: string;
    longSummary: string;
    mainTopics: unknown;
    searchKeywords: unknown;
    sourceModel: string;
    status: string;
    error: string;
    inputChars: number;
    transcriptTruncated: boolean;
    rawJson: unknown;
  } | null;
  transcript: Array<{
    segmentId: string;
    segmentIndex: number;
    startTime: string;
    endTime: string;
    startSeconds: number | null;
    endSeconds: number | null;
    speakerId: string;
    speakerName: string;
    segmentType: string;
    bibleReferences: unknown[];
    otherReferences: unknown[];
    text: string;
  }>;
  transcriptReferences: Array<{
    referenceId: string;
    segmentIndex: number | null;
    referenceType: string;
    sourceScope: string;
    reference: string;
    startTime: string;
    endTime: string;
    startSeconds: number | null;
    endSeconds: number | null;
    context: string;
    text: string;
    rawReference: unknown;
  }>;
  intelligenceItems: Array<{
    id: string;
    itemType: string;
    label: string;
    summary: string;
    speakers: string[];
    confidence: string;
    sourceTimes: unknown;
    valueJson: unknown;
  }>;
  podtrac: {
    episodes: PodtracEpisodeRow[];
    recentDaily: PodtracDailyActivityRow[];
  };
};

export type EpisodeChatSource = {
  sourceType: string;
  trackId: string;
  title: string;
  publishDate: string;
  segmentId: string;
  text: string;
  startTime: string;
  endTime: string;
  speakers: string[];
  score: number;
  vectorModel: string;
};

export type PodtracDashboard = {
  counts: {
    episodes: number;
    transcriptChunks: number;
    transcriptEpisodes: number;
    speechVectors: number;
    intelligenceRows: number;
    intelligenceItems: number;
    intelligenceVectors: number;
    podtracEpisodes: number;
    podtracMatched: number;
    podtracUnmatched: number;
    podtracDailyRows: number;
    podtracCountryRows: number;
    podtracClientRows: number;
    totalDownloads: number;
  };
  topEpisodes: Array<{
    trackId: string;
    episodeTitle: string;
    publishDate: string;
    podtracEpisodeTitle: string;
    matchStatus: string;
    totalDownloads: number;
  }>;
  dailyTrend: Array<{ activityDate: string; downloads: number }>;
  countryDownloads: Array<{ country: string; downloads: number }>;
  clientDownloads: Array<{ client: string; downloads: number }>;
};

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry.trim();
      }

      if (entry && typeof entry === "object") {
        const candidate = (entry as SpeakerField).name;
        if (typeof candidate === "string") {
          return candidate.trim();
        }
      }

      return "";
    })
    .filter((name): name is string => name.length > 0);
}

function normalizeJsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function buildAudioUrl(sourceFile: string, trackId: string): string | null {
  if (!trackId) {
    return null;
  }

  if (/^https?:\/\//i.test(sourceFile)) {
    return sourceFile;
  }

  return `https://storage.googleapis.com/aic-podcasts-2026/podcasts/${trackId}.mp3`;
}

function normalizeTrackRow(row: EpisodeBaseRow): EpisodeSearchItem {
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
    hitTypes: [],
    snippet: "",
  };
}

function addSearchHit(item: EpisodeSearchItem, hitType: string, score: number, snippet: string) {
  const normalizedHitType = hitType.trim();
  if (normalizedHitType && !item.hitTypes.includes(normalizedHitType)) {
    item.hitTypes.push(normalizedHitType);
  }

  if (score > item.score) {
    item.score = score;
  }

  if (!item.snippet && snippet) {
    item.snippet = snippet;
  }
}

function clampScore(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return parsed;
}

function resolveScopeFilters(scope: EpisodeSearchScope | undefined): {
  itemTypes: string[] | null;
  vectorTypes: string[] | null;
  includeTranscriptTextMatch: boolean;
  includeTranscriptVectorMatch: boolean;
  includeIntelligenceTextMatch: boolean;
} {
  const resolvedScope = scope ?? "all";

  switch (resolvedScope) {
    case "title":
      return {
        itemTypes: null,
        vectorTypes: null,
        includeTranscriptTextMatch: false,
        includeTranscriptVectorMatch: false,
        includeIntelligenceTextMatch: false,
      };

    case "passage":
      return {
        itemTypes: ["scripture_references"],
        vectorTypes: ["scripture_references"],
        includeTranscriptTextMatch: true,
        includeTranscriptVectorMatch: true,
        includeIntelligenceTextMatch: true,
      };

    case "guest":
      return {
        itemTypes: ["people_mentioned", "interviews"],
        vectorTypes: ["people_mentioned", "interviews"],
        includeTranscriptTextMatch: true,
        includeTranscriptVectorMatch: true,
        includeIntelligenceTextMatch: true,
      };

    case "interview":
      return {
        itemTypes: ["interviews"],
        vectorTypes: ["interviews"],
        includeTranscriptTextMatch: true,
        includeTranscriptVectorMatch: true,
        includeIntelligenceTextMatch: true,
      };

    case "theme":
      return {
        itemTypes: ["sermon_illustrations", "stories", "notable_quotes"],
        vectorTypes: [
          "episode_topics_keywords",
          "episode_executive_summary",
          "episode_long_summary",
          "sermon_illustrations",
          "stories",
          "notable_quotes",
        ],
        includeTranscriptTextMatch: true,
        includeTranscriptVectorMatch: true,
        includeIntelligenceTextMatch: true,
      };

    default:
      return {
        itemTypes: null,
        vectorTypes: null,
        includeTranscriptTextMatch: true,
        includeTranscriptVectorMatch: true,
        includeIntelligenceTextMatch: true,
      };
  }
}

export async function getEpisodeBaseRows(): Promise<EpisodeBaseRow[]> {
  return await queryRows<EpisodeBaseRow>(`
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
  `);
}

export async function getRecentEpisodes(limit = 40): Promise<EpisodeSearchItem[]> {
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

  return rows.map((row) => ({
    ...normalizeTrackRow(row),
    hitTypes: ["recent"],
    score: 0,
    snippet: "",
  }));
}

export async function searchEpisodesByText(
  query: string,
  options: { limit?: number; trackId?: string; scope?: EpisodeSearchScope } = {},
): Promise<EpisodeSearchItem[]> {
  const q = query.trim();

  if (!q) {
    return getRecentEpisodes(options.limit);
  }

  const limit = options.limit ?? 40;
  const scope = resolveScopeFilters(options.scope);

  const rows = await queryRows<TextSearchMatchRow>(
    `
      with q as (
        select
          $1::text as raw_query,
          coalesce(websearch_to_tsquery('english', $1::text), websearch_to_tsquery('english', ' ')) as query_ts
      ),
      base as (
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
      )
      select
        b.track_id,
        b.title,
        b.publish_date,
        b.album,
        b.category,
        b.detail,
        b.source_file,
        b.has_transcript,
        b.has_intelligence,
        b.has_vectors,
        b.has_podtrac,
        m.hit_source,
        m.score,
        m.snippet
      from base b
      cross join q
      join lateral (
        select
          'episode.title_or_detail' as hit_source,
          coalesce(ts_rank_cd(to_tsvector('english', coalesce(b.title, '') || ' ' || coalesce(b.detail, '')), q.query_ts), 0.25) as score,
          coalesce(b.title, '') as snippet
        where q.query_ts @@ to_tsvector('english', coalesce(b.title, '') || ' ' || coalesce(b.detail, ''))
           or lower(coalesce(b.title, '')) like ('%' || lower(q.raw_query) || '%')
           or lower(coalesce(b.detail, '')) like ('%' || lower(q.raw_query) || '%')

        union all

        select
          'intelligence.summary' as hit_source,
          coalesce(ts_rank_cd(ei.search_tsv, q.query_ts), 0.22) as score,
          coalesce(ei.executive_summary, '') as snippet
        from episode_intelligence ei
        where ei.track_id = b.track_id
          and $4::boolean
          and q.query_ts @@ ei.search_tsv

        union all

        select
          'intelligence.long_summary' as hit_source,
          coalesce(ts_rank_cd(ei.search_tsv, q.query_ts), 0.22) as score,
          coalesce(ei.long_summary, '') as snippet
        from episode_intelligence ei
        where ei.track_id = b.track_id
          and $4::boolean
          and q.query_ts @@ ei.search_tsv

        union all

        select
          'intelligence.item.' || coalesce(i.item_type, 'other') as hit_source,
          coalesce(ts_rank_cd(i.search_tsv, q.query_ts), 0.2) as score,
          coalesce(i.label, '') || ' ' || coalesce(i.summary, '') as snippet
        from episode_intelligence_items i
        where i.track_id = b.track_id
          and $4::boolean
          and ($5::text[] is null or i.item_type = any($5::text[]))
          and q.query_ts @@ i.search_tsv

        union all

        select
          'transcript.match' as hit_source,
          greatest(coalesce(ts_rank_cd(tc.search_tsv, q.query_ts), 0), 0.18) as score,
          regexp_replace(
            coalesce(ts_headline('english', coalesce(tc.text, ''), q.query_ts, 'MaxWords=38, MinWords=12, ShortWord=3'), tc.text, ''),
            '<[^>]+>',
            '',
            'g'
          ) as snippet
        from transcript_chunks tc
        where tc.track_id = b.track_id
          and $6::boolean
          and (
            q.query_ts @@ tc.search_tsv
            or lower(coalesce(tc.text, '')) like ('%' || lower(q.raw_query) || '%')
            or lower(coalesce(tc.title, '')) like ('%' || lower(q.raw_query) || '%')
          )
      ) m on true
      where ($2::text is null or b.track_id = $2)
        and q.raw_query is not null
        and b.track_id is not null
      order by m.score desc, b.publish_date desc
      limit $3
    `,
    [q, options.trackId ?? null, limit, scope.includeIntelligenceTextMatch, scope.itemTypes, scope.includeTranscriptTextMatch],
  );

  const merged = new Map<string, EpisodeSearchItem>();

  for (const row of rows) {
    const score = clampScore(row.score);
    if (score <= 0 && !row.snippet) {
      continue;
    }

    const existing = merged.get(row.track_id);
    if (!existing) {
      const normalized = normalizeTrackRow(row);
      addSearchHit(normalized, row.hit_source, score, row.snippet);
      merged.set(row.track_id, normalized);
      continue;
    }

    addSearchHit(existing, row.hit_source, score, row.snippet);
  }

  return [...merged.values()]
    .filter((item) => item.hitTypes.length > 0)
    .sort((left, right) => {
      if (right.score === left.score) {
        return right.hitTypes.length - left.hitTypes.length;
      }

      return right.score - left.score;
    })
    .slice(0, limit);
}

export async function searchEpisodesByVector(
  embedding: number[],
  limit = 20,
  options: { trackId?: string } = {},
  scope?: EpisodeSearchScope,
): Promise<EpisodeSearchItem[]> {
  const embeddingText = `[${embedding.join(",")}]`;
  const activeScope = resolveScopeFilters(scope);
  const rows = await queryRows<VectorSearchTrackRow>(
    `
      with matches as (
        select
          'transcript' as source_type,
          tc.track_id,
          coalesce(tc.title, e.title, 'Episode transcript') as title,
          coalesce(tc.publish_date, e.publish_date, '') as publish_date,
          tc.custom_id,
          coalesce(tc.text, '') as text,
          coalesce(tc.start_time, '') as start_time,
          coalesce(tc.end_time, '') as end_time,
          tc.speakers,
          coalesce(1 - (tc.embedding <=> $1::vector), 0) as score,
          coalesce(tc.embedding_model, '') as source_model
        from transcript_chunks tc
        join episodes e on e.track_id = tc.track_id
        where tc.embedding is not null
          and $4::boolean
          and ($2::text is null or tc.track_id = $2)

        union all

        select
          'intelligence.' || coalesce(iv.vector_type, 'item') as source_type,
          iv.track_id,
          coalesce(iv.title, e.title, 'Episode intelligence') as title,
          coalesce(iv.publish_date, e.publish_date, '') as publish_date,
          iv.custom_id,
          coalesce(iv.text, '') as text,
          '' as start_time,
          '' as end_time,
          iv.speakers,
          coalesce(1 - (iv.embedding <=> $1::vector), 0) as score,
          coalesce(iv.source_model, '') as source_model
        from episode_intelligence_vectors iv
        join episodes e on e.track_id = iv.track_id
        where iv.embedding is not null
          and ($5::text[] is null or iv.vector_type = any($5::text[]))
          and ($2::text is null or iv.track_id = $2)
      )
      select
        source_type,
        track_id,
        title,
        publish_date,
        custom_id,
        text,
        start_time,
        end_time,
        speakers,
        score,
        source_model
      from matches
      where score > 0
      order by score desc
      limit $3
    `,
    [
      embeddingText,
      options.trackId ?? null,
      limit,
      activeScope.includeTranscriptVectorMatch,
      activeScope.vectorTypes,
    ],
  );

  if (rows.length === 0) {
    return [];
  }

  const trackIds = [...new Set(rows.map((row) => row.track_id))];
  const metadataRows = await queryRows<EpisodeBaseRow>(
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
      where e.track_id = any($1::text[])
    `,
    [trackIds],
  );

  const baseByTrack = new Map<string, EpisodeBaseRow>(metadataRows.map((row) => [row.track_id, row]));
  const results = new Map<string, EpisodeSearchItem>();

  for (const row of rows) {
    const base = baseByTrack.get(row.track_id);
    if (!base) {
      continue;
    }

    const existing = results.get(row.track_id);
    if (!existing) {
      const normalized = normalizeTrackRow(base);
      addSearchHit(normalized, row.source_type, row.score, row.text.slice(0, 180));
      results.set(row.track_id, normalized);
      continue;
    }

    addSearchHit(existing, row.source_type, row.score, row.text.slice(0, 180));
  }

  return [...results.values()].sort((left, right) => right.score - left.score).slice(0, limit);
}

export async function searchEpisodesWithVectorFallback(
  query: string,
  options: SearchOptions = {},
): Promise<EpisodeSearchItem[]> {
  const limit = options.limit ?? 40;
  const byText = await searchEpisodesByText(query, {
    limit,
    trackId: options.trackId,
    scope: options.scope,
  });
  const resolvedScope = resolveScopeFilters(options.scope);
  const includeVector = (options.includeVector ?? true) && resolvedScope.includeTranscriptVectorMatch;

  if (!includeVector) {
    return byText;
  }

  try {
    const embedding = await embedQuery(query);
    const byVector = await searchEpisodesByVector(
      embedding,
      limit,
      { trackId: options.trackId },
      options.scope,
    );

    const merged = new Map<string, EpisodeSearchItem>();

    for (const row of byText) {
      merged.set(row.trackId, row);
    }

    for (const row of byVector) {
      const existing = merged.get(row.trackId);
      if (!existing) {
        merged.set(row.trackId, row);
        continue;
      }

      for (const source of row.hitTypes) {
        if (!existing.hitTypes.includes(source)) {
          existing.hitTypes.push(source);
        }
      }
      if (row.score > existing.score) {
        existing.score = row.score;
      }
    }

    return [...merged.values()].sort((left, right) => right.score - left.score).slice(0, limit);
  } catch (error) {
    console.warn("Hybrid episode search degraded to text search", error);
    return byText;
  }
}

export async function getEpisodeDetail(trackId: string): Promise<EpisodeDetail | null> {
  const [
    episodeRows,
    intelligenceRows,
    transcriptSegmentRows,
    transcriptChunkRows,
    transcriptReferenceRows,
    intelligenceItemRows,
    podtracRows,
    podtracDailyRows,
  ] =
    await Promise.all([
      queryRows<EpisodeDetailRow>(
        `
          select
            e.track_id,
            e.title,
            e.publish_date,
            e.album,
            e.category,
            e.detail,
            e.source_file,
            exists(select 1 from transcript_segments ts where ts.track_id = e.track_id)
            or exists(select 1 from transcript_chunks tc where tc.track_id = e.track_id) as has_transcript,
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
          where e.track_id = $1
          limit 1
        `,
        [trackId],
      ),
      queryRows<EpisodeIntelligenceRow>(
        `
          select
            track_id,
            title,
            publish_date,
            episode_type,
            executive_summary,
            long_summary,
            main_topics,
            search_keywords,
            raw_json,
            source_model,
            status,
            error,
            input_chars,
            transcript_truncated
          from episode_intelligence
          where track_id = $1
          limit 1
        `,
        [trackId],
      ),
      queryRows<TranscriptSegmentRow>(
        `
          select
            segment_id,
            track_id,
            segment_index,
            start_time,
            end_time,
            start_seconds,
            end_seconds,
            speaker_id,
            speaker_name,
            segment_type,
            text,
            bible_references,
            other_references
          from transcript_segments
          where track_id = $1
          order by segment_index asc
        `,
        [trackId],
      ),
      queryRows<TranscriptChunkRow>(
        `
          select
            custom_id,
            track_id,
            title,
            start_time,
            end_time,
            speakers,
            segment_type,
            text
          from transcript_chunks
          where track_id = $1
          order by
            CASE
              WHEN start_time ~ '^\d+:\d{2}:\d{2}$' THEN start_time::interval
              ELSE NULL
            END NULLS LAST,
            custom_id asc
        `,
        [trackId],
      ),
      queryRows<TranscriptReferenceRow>(
        `
          select
            reference_id,
            track_id,
            segment_index,
            reference_type,
            source_scope,
            reference,
            start_time,
            end_time,
            start_seconds,
            end_seconds,
            context,
            text,
            raw_reference
          from transcript_references
          where track_id = $1
          order by
            case when source_scope = 'episode' then 0 else 1 end,
            reference_type asc,
            start_seconds asc nulls last,
            reference asc
        `,
        [trackId],
      ),
      queryRows<IntelligenceItemRow>(
        `
          select
            id,
            item_type,
            label,
            summary,
            source_times,
            speakers,
            confidence,
            value_json
          from episode_intelligence_items
          where track_id = $1
          order by item_type asc, label asc, id asc
        `,
        [trackId],
      ),
      queryRows<PodtracEpisodeRow>(
        `
          select
            pe.podtrac_episode_id,
            pe.title,
            pe.publish_date::text,
            pe.match_status,
            coalesce(sum(pda.download_count), 0)::text as total_downloads,
            max(pda.activity_date)::text as last_activity_date
          from podtrac_episodes pe
          left join podtrac_daily_activity pda on pda.podtrac_episode_id = pe.podtrac_episode_id
          where pe.track_id = $1
          group by
            pe.podtrac_episode_id,
            pe.title,
            pe.publish_date,
            pe.match_status
          order by coalesce(sum(pda.download_count), 0) desc
        `,
        [trackId],
      ),
      queryRows<PodtracDailyActivityRow>(
        `
          select
            pda.activity_date::text as activity_date,
            pda.download_count
          from podtrac_episodes pe
          join podtrac_daily_activity pda on pda.podtrac_episode_id = pe.podtrac_episode_id
          where pe.track_id = $1
          order by pda.activity_date desc
          limit 120
        `,
        [trackId],
      ),
    ]);

  const episode = episodeRows[0];
  if (!episode) {
    return null;
  }

  const transcript =
    transcriptSegmentRows.length > 0
      ? transcriptSegmentRows.map((row) => ({
          segmentId: row.segment_id,
          segmentIndex: row.segment_index,
          startTime: row.start_time,
          endTime: row.end_time,
          startSeconds: row.start_seconds,
          endSeconds: row.end_seconds,
          speakerId: row.speaker_id,
          speakerName: row.speaker_name,
          segmentType: row.segment_type,
          bibleReferences: normalizeJsonArray(row.bible_references),
          otherReferences: normalizeJsonArray(row.other_references),
          text: row.text,
        }))
      : transcriptChunkRows.map((row, index) => ({
          segmentId: row.custom_id,
          segmentIndex: index,
          startTime: row.start_time,
          endTime: row.end_time,
          startSeconds: null,
          endSeconds: null,
          speakerId: "",
          speakerName: normalizeArray(row.speakers).join(", "),
          segmentType: row.segment_type,
          bibleReferences: [],
          otherReferences: [],
          text: row.text,
        }));

  const transcriptReferences = transcriptReferenceRows.map((row) => ({
    referenceId: row.reference_id,
    segmentIndex: row.segment_index,
    referenceType: row.reference_type,
    sourceScope: row.source_scope,
    reference: row.reference,
    startTime: row.start_time,
    endTime: row.end_time,
    startSeconds: row.start_seconds,
    endSeconds: row.end_seconds,
    context: row.context,
    text: row.text,
    rawReference: row.raw_reference,
  }));

  const intelligence = intelligenceRows[0] ?? null;

  return {
    episode: {
      trackId: episode.track_id,
      title: episode.title,
      publishDate: episode.publish_date,
      album: episode.album,
      category: episode.category,
      detail: episode.detail,
      sourceFile: episode.source_file,
      hasTranscript: episode.has_transcript,
      hasIntelligence: episode.has_intelligence,
      hasVectors: episode.has_vectors,
      hasPodtrac: episode.has_podtrac,
      audioUrl: buildAudioUrl(episode.source_file, episode.track_id) ?? "",
    },
    intelligence: intelligence
      ? {
          episodeType: intelligence.episode_type,
          executiveSummary: intelligence.executive_summary,
          longSummary: intelligence.long_summary,
          mainTopics: intelligence.main_topics,
          searchKeywords: intelligence.search_keywords,
          sourceModel: intelligence.source_model,
          status: intelligence.status,
          error: intelligence.error,
          inputChars: intelligence.input_chars,
          transcriptTruncated: intelligence.transcript_truncated,
          rawJson: intelligence.raw_json,
        }
      : null,
    transcript,
    transcriptReferences,
    intelligenceItems: intelligenceItemRows.map((row) => ({
      id: row.id,
      itemType: row.item_type,
      label: row.label,
      summary: row.summary,
      speakers: normalizeArray(row.speakers),
      confidence: row.confidence,
      sourceTimes: row.source_times,
      valueJson: row.value_json,
    })),
    podtrac: {
      episodes: podtracRows,
      recentDaily: podtracDailyRows,
    },
  };
}

export async function getEpisodeRagSources(
  query: string,
  options: { trackId?: string; topK?: number },
): Promise<EpisodeChatSource[]> {
  const trackId = options.trackId?.trim();
  const topK = options.topK ?? 10;

  const embedding = await embedQuery(query);
  const rows = await queryRows<RAGVectorHitRow>(
    `
      with matches as (
        select
          'transcript' as source_type,
          tc.track_id,
          coalesce(e.title, tc.title, 'Episode') as title,
          coalesce(tc.publish_date, e.publish_date, '') as publish_date,
          tc.custom_id,
          coalesce(tc.text, '') as text,
          tc.start_time,
          tc.end_time,
          tc.speakers,
          coalesce(1 - (tc.embedding <=> $1::vector), 0) as score,
          coalesce(tc.embedding_model, '') as source_model
        from transcript_chunks tc
        join episodes e on e.track_id = tc.track_id
        where tc.embedding is not null
          and ($2::text is null or tc.track_id = $2)

        union all

        select
          'intelligence.' || coalesce(iv.vector_type, 'item') as source_type,
          iv.track_id,
          coalesce(e.title, iv.title, 'Episode') as title,
          coalesce(iv.publish_date, e.publish_date, '') as publish_date,
          iv.custom_id,
          coalesce(iv.text, '') as text,
          null::text as start_time,
          null::text as end_time,
          iv.speakers,
          coalesce(1 - (iv.embedding <=> $1::vector), 0) as score,
          coalesce(iv.source_model, '') as source_model
        from episode_intelligence_vectors iv
        join episodes e on e.track_id = iv.track_id
        where iv.embedding is not null
          and ($2::text is null or iv.track_id = $2)
      )
      select
        source_type,
        track_id,
        title,
        publish_date,
        custom_id,
        text,
        start_time,
        end_time,
        speakers,
        score,
        source_model
      from matches
      where score > 0.2
      order by score desc
      limit $3
    `,
    [`[${embedding.join(",")}]`, trackId ?? null, topK],
  );

  return rows.map((row) => ({
    sourceType: row.source_type,
    trackId: row.track_id,
    title: row.title,
    publishDate: row.publish_date,
    segmentId: row.custom_id,
    text: row.text,
    startTime: row.start_time ?? "",
    endTime: row.end_time ?? "",
    speakers: normalizeArray(row.speakers),
    score: Number(row.score),
    vectorModel: row.source_model ?? "",
  }));
}

export async function getEpisodeSummarySources(trackIds: string[]): Promise<EpisodeChatSource[]> {
  const uniqueTrackIds = [...new Set(trackIds.map((trackId) => trackId.trim()).filter(Boolean))];

  if (uniqueTrackIds.length === 0) {
    return [];
  }

  const rows = await queryRows<EpisodeSummarySourceRow>(
    `
      select
        ei.track_id,
        coalesce(e.title, ei.title, 'Episode') as title,
        coalesce(e.publish_date, ei.publish_date, '') as publish_date,
        coalesce(ei.executive_summary, '') as executive_summary,
        coalesce(ei.long_summary, '') as long_summary,
        coalesce(ei.source_model, '') as source_model
      from episode_intelligence ei
      left join episodes e on e.track_id = ei.track_id
      where ei.track_id = any($1::text[])
      order by array_position($1::text[], ei.track_id)
    `,
    [uniqueTrackIds],
  );

  return rows
    .map((row) => {
      const text = [
        row.executive_summary ? `Executive summary: ${row.executive_summary}` : "",
        row.long_summary ? `Long summary: ${row.long_summary}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      return {
        sourceType: "episode.summary",
        trackId: row.track_id,
        title: row.title,
        publishDate: row.publish_date,
        segmentId: `${row.track_id}:summary`,
        text,
        startTime: "",
        endTime: "",
        speakers: [],
        score: 1,
        vectorModel: row.source_model,
      };
    })
    .filter((source) => source.text.trim().length > 0);
}

export async function getPodtracDashboard(): Promise<PodtracDashboard> {
  const [countRows, topRows, trendRows, countryRows, clientRows] = await Promise.all([
    queryRows<DashboardRow>(
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
          coalesce(sum(download_count), 0)::text as podtrac_total_downloads
        from podtrac_daily_activity
      `,
    ),
    queryRows<TopEpisodeRow>(
      `
        with podtrac_by_track as (
          select
            pe.track_id,
            max(pe.title) as podtrac_title,
            coalesce(string_agg(distinct pe.match_status, ', '), 'unmatched') as match_status,
            coalesce(sum(pda.download_count), 0)::text as downloads
          from podtrac_episodes pe
          left join podtrac_daily_activity pda on pda.podtrac_episode_id = pe.podtrac_episode_id
          where pe.track_id is not null
          group by pe.track_id
        )
        select
          e.track_id,
          e.title,
          e.publish_date,
          coalesce(pbt.podtrac_title, '') as podtrac_title,
          coalesce(pbt.match_status, 'unmatched') as match_status,
          coalesce(pbt.downloads, '0') as downloads
        from episodes e
        left join podtrac_by_track pbt on pbt.track_id = e.track_id
        order by coalesce(pbt.downloads::bigint, 0) desc, e.publish_date desc
        limit 20
      `,
    ),
    queryRows<TrendRow>(
      `
        select
          activity_date::text as activity_date,
          coalesce(sum(download_count), 0)::text as downloads
        from podtrac_daily_activity
        group by activity_date
        order by activity_date desc
        limit 120
      `,
    ),
    queryRows<CountryRow>(
      `
        select
          pc.name,
          coalesce(sum(pac.download_count), 0)::text as downloads
        from podtrac_activity_by_country pac
        join podtrac_countries pc on pc.podtrac_country_id = pac.podtrac_country_id
        group by pc.name
        order by sum(pac.download_count) desc
        limit 15
      `,
    ),
    queryRows<CountryRow>(
      `
        select
          pco.name,
          coalesce(sum(pcl.download_count), 0)::text as downloads
        from podtrac_activity_by_client pcl
        join podtrac_clients pco on pco.podtrac_client_id = pcl.podtrac_client_id
        group by pco.name
        order by sum(pcl.download_count) desc
        limit 15
      `,
    ),
  ]);

  const counts = countRows[0];

  return {
    counts: {
      episodes: toNumber(counts.episodes_count),
      transcriptChunks: toNumber(counts.transcript_chunks_count),
      transcriptEpisodes: toNumber(counts.transcript_episode_count),
      speechVectors: toNumber(counts.speech_vector_count),
      intelligenceRows: toNumber(counts.intelligence_count),
      intelligenceItems: toNumber(counts.intelligence_items_count),
      intelligenceVectors: toNumber(counts.intelligence_vector_count),
      podtracEpisodes: toNumber(counts.podtrac_episode_count),
      podtracMatched: toNumber(counts.podtrac_matched_count),
      podtracUnmatched: toNumber(counts.podtrac_unmatched_count),
      podtracDailyRows: toNumber(counts.podtrac_daily_rows),
      podtracCountryRows: toNumber(counts.podtrac_country_rows),
      podtracClientRows: toNumber(counts.podtrac_client_rows),
      totalDownloads: toNumber(counts.podtrac_total_downloads),
    },
    topEpisodes: topRows.map((row) => ({
      trackId: row.track_id,
      episodeTitle: row.title,
      publishDate: row.publish_date,
      podtracEpisodeTitle: row.podtrac_title,
      matchStatus: row.match_status,
      totalDownloads: toNumber(row.downloads),
    })),
    dailyTrend: trendRows.map((row) => ({
      activityDate: row.activity_date,
      downloads: toNumber(row.downloads),
    })),
    countryDownloads: countryRows.map((row) => ({
      country: row.name,
      downloads: toNumber(row.downloads),
    })),
    clientDownloads: clientRows.map((row) => ({
      client: row.name,
      downloads: toNumber(row.downloads),
    })),
  };
}

async function embedQuery(query: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing in environment");
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: query,
      encoding_format: "float",
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Embedding request failed: ${response.status} ${details}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };

  const embedding = payload.data?.[0]?.embedding;

  if (!Array.isArray(embedding)) {
    throw new Error("Invalid embedding response from provider");
  }

  return embedding;
}

export { buildAudioUrl };
