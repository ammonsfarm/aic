import { NextRequest, NextResponse } from "next/server";

import { getEpisodeRagSources, type EpisodeChatSource } from "@/lib/podcast-data";
import { queryRows } from "@/lib/db";
import {
  checkChatRateLimit,
  publicChatError,
  validateChatRequestBody,
  validateQuestionLength,
} from "@/lib/rag-route-guards";
import { requireSignedInAppUser } from "@/lib/rbac";

export const runtime = "nodejs";

type SearchMode = "hybrid" | "vector" | "text";

type RagSearchRequest = {
  query?: string;
  limit?: number;
  topK?: number;
  trackId?: string;
  mode?: string;
};

type RagTextHitRow = {
  source_type: string;
  track_id: string;
  title: string;
  publish_date: string;
  custom_id: string;
  text: string;
  start_time: string | null;
  end_time: string | null;
  speakers: unknown;
  score: string | number;
  source_model: string | null;
};

type RagSearchResult = {
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
  matchMode: "vector" | "text";
};

type SpeakerField = {
  name?: unknown;
};

function normalizeMode(value: string | undefined): SearchMode {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "vector" || normalized === "text") {
    return normalized;
  }

  return "hybrid";
}

function normalizeSpeakers(value: unknown): string[] {
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
        return typeof candidate === "string" ? candidate.trim() : "";
      }

      return "";
    })
    .filter((entry): entry is string => entry.length > 0);
}

function normalizeVectorSource(source: EpisodeChatSource): RagSearchResult {
  return {
    sourceType: source.sourceType,
    trackId: source.trackId,
    title: source.title,
    publishDate: source.publishDate,
    segmentId: source.segmentId,
    text: source.text,
    startTime: source.startTime,
    endTime: source.endTime,
    speakers: source.speakers,
    score: Number(source.score) || 0,
    vectorModel: source.vectorModel,
    matchMode: "vector",
  };
}

function normalizeTextSource(row: RagTextHitRow): RagSearchResult {
  return {
    sourceType: row.source_type,
    trackId: row.track_id,
    title: row.title,
    publishDate: row.publish_date,
    segmentId: row.custom_id,
    text: row.text,
    startTime: row.start_time ?? "",
    endTime: row.end_time ?? "",
    speakers: normalizeSpeakers(row.speakers),
    score: Number(row.score) || 0,
    vectorModel: row.source_model ?? "",
    matchMode: "text",
  };
}

function mergeResults(vectorResults: RagSearchResult[], textResults: RagSearchResult[], limit: number) {
  const merged = new Map<string, RagSearchResult>();

  for (const result of [...vectorResults, ...textResults]) {
    const key = `${result.sourceType}:${result.trackId}:${result.segmentId}`;
    const existing = merged.get(key);

    if (!existing || result.score > existing.score) {
      merged.set(key, result);
    }
  }

  return [...merged.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

async function getTextSearchResults(query: string, limit: number, trackId?: string): Promise<RagSearchResult[]> {
  const rows = await queryRows<RagTextHitRow>(
    `
      with q as (
        select websearch_to_tsquery('english', $1::text) as query_ts
      ), matches as (
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
          greatest(coalesce(ts_rank_cd(tc.search_tsv, q.query_ts), 0), 0.18) as score,
          coalesce(tc.embedding_model, '') as source_model
        from transcript_chunks tc
        join episodes e on e.track_id = tc.track_id
        cross join q
        where q.query_ts @@ tc.search_tsv
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
          greatest(coalesce(ts_rank_cd(to_tsvector('english', coalesce(iv.text, '')), q.query_ts), 0), 0.16) as score,
          coalesce(iv.source_model, '') as source_model
        from episode_intelligence_vectors iv
        join episodes e on e.track_id = iv.track_id
        cross join q
        where q.query_ts @@ to_tsvector('english', coalesce(iv.text, ''))
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
      order by score desc
      limit $3
    `,
    [query, trackId?.trim() || null, limit],
  );

  return rows.map(normalizeTextSource);
}

export async function POST(request: NextRequest) {
  const bodyError = validateChatRequestBody(request);
  if (bodyError) {
    return NextResponse.json({ error: bodyError }, { status: 413 });
  }

  const appUser = await requireSignedInAppUser();
  const rateLimit = checkChatRateLimit(request, appUser.clerkUserId);
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many search requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const payload = (await request.json().catch(() => ({}))) as RagSearchRequest;
  const searchQuery = (payload.query ?? "").toString().trim();
  const requestedLimit = Number(payload.limit ?? payload.topK ?? 10);
  const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 10, 40));
  const mode = normalizeMode(payload.mode);
  const trackId = (payload.trackId ?? "").toString().trim() || undefined;

  if (!searchQuery) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const questionError = validateQuestionLength(searchQuery, true);
  if (questionError) {
    return NextResponse.json({ error: questionError }, { status: 400 });
  }

  const warnings: string[] = [];
  let vectorResults: RagSearchResult[] = [];
  let textResults: RagSearchResult[] = [];

  try {
    if (mode === "vector" || mode === "hybrid") {
      vectorResults = (await getEpisodeRagSources(searchQuery, { trackId, topK: limit })).map(normalizeVectorSource);
    }
  } catch (error) {
    if (mode === "vector") {
      return NextResponse.json({ error: publicChatError(error) }, { status: 503 });
    }

    console.warn("rag-search vector retrieval failed; using text results only", error);
    warnings.push("Vector retrieval failed; returned text results only.");
  }

  if (mode === "text" || mode === "hybrid") {
    textResults = await getTextSearchResults(searchQuery, limit, trackId);
  }

  const results = mode === "vector" ? vectorResults : mode === "text" ? textResults : mergeResults(vectorResults, textResults, limit);

  return NextResponse.json({
    query: searchQuery,
    mode,
    trackId: trackId ?? null,
    limit,
    results,
    warnings,
  });
}
