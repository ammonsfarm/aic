import "server-only";

import { queryRows } from "@/lib/db";
import { isPublicEpisodeTrackId } from "@/lib/episode-audio";

export type FallbackPost = {
  documentId: string;
  title: string;
  slug: string;
  contentType: string;
  summary: string;
  body: string;
  publishDate: string | null;
};

export type FallbackEpisode = {
  documentId: string;
  title: string;
  slug: string;
  trackId: string;
  programDate: string | null;
  summary: string;
  description: string;
  audioUrl: string;
  durationSeconds: null;
};

export type FallbackPage<T> = {
  items: T[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
};

type CountRow = { total: string };

type PostRow = {
  post_id: string;
  source_type: string;
  title: string;
  slug: string;
  publish_date: string | null;
  summary: string;
  content_html: string;
  text: string;
};

type EpisodeRow = {
  track_id: string;
  title: string;
  publish_date: string | null;
  detail: string;
  sermon_url: string;
};

function boundedPage(page: number, pageSize: number) {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const safePageSize = Number.isFinite(pageSize) ? Math.min(100, Math.max(1, Math.floor(pageSize))) : 24;
  return { page: safePage, pageSize: safePageSize, offset: (safePage - 1) * safePageSize };
}

function fallbackContentType(sourceType: string) {
  return sourceType === "pastorwood_devotional" ? "devotional" : "written-resource";
}

function postSourceFilter(contentType: string | undefined) {
  if (contentType === "devotional") return "pastorwood_devotional";
  if (contentType === "written-resource") return "not-devotional";
  return "";
}

function toPost(row: PostRow): FallbackPost {
  const body = row.content_html?.trim() || row.text?.trim() || "";
  return {
    documentId: `aic-fallback-post:${row.post_id}`,
    title: row.title,
    slug: row.slug,
    contentType: fallbackContentType(row.source_type),
    summary: row.summary?.trim() || row.text?.replace(/\s+/g, " ").trim().slice(0, 600) || "",
    body,
    publishDate: row.publish_date || null,
  };
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 180);
}

function episodeSlug(row: EpisodeRow) {
  if (row.sermon_url) {
    try {
      const pathname = new URL(row.sermon_url, "https://www.pastorwood.org").pathname;
      const candidate = pathname.split("/").filter(Boolean).at(-1) || "";
      const normalized = slugify(candidate);
      if (normalized) return normalized;
    } catch {
      // Fall through to the stable title-derived slug.
    }
  }
  return slugify(row.title) || `episode-${slugify(row.track_id)}`;
}

function toEpisode(row: EpisodeRow): FallbackEpisode {
  const description = row.detail?.trim() || "";
  return {
    documentId: `aic-fallback-episode:${row.track_id}`,
    title: row.title,
    slug: episodeSlug(row),
    trackId: row.track_id,
    programDate: row.publish_date || null,
    summary: description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600),
    description,
    audioUrl: isPublicEpisodeTrackId(row.track_id) ? `/media/episodes/${encodeURIComponent(row.track_id)}` : "",
    durationSeconds: null,
  };
}

const LATEST_POSTS_SQL = `
  select distinct on (post_id)
    post_id::text,
    source_type,
    title,
    slug,
    publish_date::text,
    coalesce(summary, '') as summary,
    coalesce(content_html, '') as content_html,
    coalesce(text, '') as text
  from pastorwood_posts
  order by
    post_id,
    updated_at desc nulls last,
    modified_at desc nulls last,
    published_at desc nulls last
`;

export async function getFallbackPostsPage(
  contentType: string | undefined,
  requestedPage: number,
  requestedPageSize: number,
): Promise<FallbackPage<FallbackPost>> {
  const { page, pageSize, offset } = boundedPage(requestedPage, requestedPageSize);
  const sourceFilter = postSourceFilter(contentType);
  const where = sourceFilter === "pastorwood_devotional"
    ? "source_type = 'pastorwood_devotional'"
    : sourceFilter === "not-devotional"
      ? "source_type <> 'pastorwood_devotional'"
      : "true";
  const [counts, rows] = await Promise.all([
    queryRows<CountRow>(`select count(*)::text as total from (${LATEST_POSTS_SQL}) latest where ${where}`),
    queryRows<PostRow>(`
      select *
      from (${LATEST_POSTS_SQL}) latest
      where ${where}
      order by publish_date desc nulls last, title asc
      limit $1 offset $2
    `, [pageSize, offset]),
  ]);
  const total = Number(counts[0]?.total || 0);
  return {
    items: rows.map(toPost),
    page,
    pageSize,
    pageCount: total > 0 ? Math.ceil(total / pageSize) : 0,
    total,
  };
}

export async function getFallbackPostBySlug(slug: string): Promise<FallbackPost | null> {
  const normalized = slug.trim();
  if (!normalized) return null;
  const rows = await queryRows<PostRow>(`
    select *
    from (${LATEST_POSTS_SQL}) latest
    where slug = $1 or post_id = $1
    limit 1
  `, [normalized]);
  return rows[0] ? toPost(rows[0]) : null;
}

const EPISODE_SELECT_SQL = `
  select
    e.track_id,
    e.title,
    nullif(e.publish_date, '')::text as publish_date,
    coalesce(e.detail, '') as detail,
    coalesce(sa.sermon_url, '') as sermon_url
  from episodes e
  left join lateral (
    select s.sermon_url
    from sermonaudio_sermons s
    where s.track_id = e.track_id
    order by s.sermon_url
    limit 1
  ) sa on true
`;

function episodeFilter(query: string, year: number | null) {
  const clauses = ["true"];
  const values: unknown[] = [];
  if (query) {
    values.push(`%${query}%`);
    const parameter = `$${values.length}`;
    clauses.push(`(e.title ilike ${parameter} or coalesce(e.detail, '') ilike ${parameter} or e.track_id ilike ${parameter})`);
  }
  if (year) {
    values.push(`${year}-01-01`, `${year + 1}-01-01`);
    clauses.push(`nullif(e.publish_date, '')::date >= $${values.length - 1}::date and nullif(e.publish_date, '')::date < $${values.length}::date`);
  }
  return { sql: clauses.join(" and "), values };
}

export async function getFallbackEpisodesPage(
  requestedPage: number,
  requestedPageSize: number,
  filters: { query?: string; year?: number | null } = {},
): Promise<FallbackPage<FallbackEpisode>> {
  const { page, pageSize, offset } = boundedPage(requestedPage, requestedPageSize);
  const query = Array.from((filters.query || "").trim()).slice(0, 80).join("");
  const year = Number.isSafeInteger(filters.year) && Number(filters.year) >= 1900 && Number(filters.year) <= 2100
    ? Number(filters.year)
    : null;
  const filter = episodeFilter(query, year);
  const [counts, rows] = await Promise.all([
    queryRows<CountRow>(`select count(*)::text as total from episodes e where ${filter.sql}`, filter.values),
    queryRows<EpisodeRow>(`
      ${EPISODE_SELECT_SQL}
      where ${filter.sql}
      order by nullif(e.publish_date, '')::date desc nulls last, e.title asc
      limit $${filter.values.length + 1} offset $${filter.values.length + 2}
    `, [...filter.values, pageSize, offset]),
  ]);
  const total = Number(counts[0]?.total || 0);
  return {
    items: rows.map(toEpisode),
    page,
    pageSize,
    pageCount: total > 0 ? Math.ceil(total / pageSize) : 0,
    total,
  };
}

export async function getFallbackEpisodeBySlug(slug: string): Promise<FallbackEpisode | null> {
  const normalized = slugify(slug);
  if (!normalized) return null;
  const rows = await queryRows<EpisodeRow>(`${EPISODE_SELECT_SQL} order by e.track_id`);
  const match = rows.find((row) => episodeSlug(row) === normalized || slugify(row.track_id) === normalized);
  return match ? toEpisode(match) : null;
}

export async function getFallbackEpisodeByTrackId(trackId: string): Promise<FallbackEpisode | null> {
  const normalized = trackId.trim();
  if (!normalized) return null;
  const rows = await queryRows<EpisodeRow>(`${EPISODE_SELECT_SQL} where e.track_id = $1 limit 1`, [normalized]);
  return rows[0] ? toEpisode(rows[0]) : null;
}
