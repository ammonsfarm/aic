import "server-only";

import { queryRows } from "@/lib/db";
import { isPublicEpisodeTrackId } from "@/lib/episode-audio";

export const CANONICAL_EPISODE_MEDIA_PAGE_SIZE = 20;
export const CANONICAL_EPISODE_MEDIA_MAX_PAGE_SIZE = 50;
const MAX_SEARCH_LENGTH = 160;

export type CanonicalEpisodeMediaItem = {
  source: "aic-postgresql-minio";
  trackId: string;
  title: string;
  publishDate: string;
  mime: "audio/mpeg";
  previewUrl: string;
  publicUrl: string;
};

export type CanonicalEpisodeMediaPage = {
  items: CanonicalEpisodeMediaItem[];
  pagination: {
    page: number;
    pageSize: number;
    pageCount: number;
    total: number;
  };
};

type EpisodeMediaRow = {
  track_id: string;
  title: string;
  publish_date: string | null;
  total_count: string | number;
};

function boundedInteger(value: number | undefined, fallback: number, maximum?: number) {
  const parsed = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.min(maximum ?? Number.MAX_SAFE_INTEGER, Math.max(1, parsed));
}

function escapedLikeSearch(value: string | undefined) {
  return (value || "")
    .trim()
    .slice(0, MAX_SEARCH_LENGTH)
    .replace(/[\\%_]/g, (character) => `\\${character}`);
}

function mediaItem(row: EpisodeMediaRow): CanonicalEpisodeMediaItem | null {
  if (!isPublicEpisodeTrackId(row.track_id)) return null;
  const encodedTrackId = encodeURIComponent(row.track_id);
  return {
    source: "aic-postgresql-minio",
    trackId: row.track_id,
    title: row.title || `Episode ${row.track_id}`,
    publishDate: row.publish_date || "",
    mime: "audio/mpeg",
    previewUrl: `/api/content/canonical-media/episodes/${encodedTrackId}`,
    publicUrl: `/media/episodes/${encodedTrackId}`,
  };
}

export async function listCanonicalEpisodeMedia(options: {
  page?: number;
  pageSize?: number;
  search?: string;
} = {}): Promise<CanonicalEpisodeMediaPage> {
  const page = boundedInteger(options.page, 1);
  const pageSize = boundedInteger(
    options.pageSize,
    CANONICAL_EPISODE_MEDIA_PAGE_SIZE,
    CANONICAL_EPISODE_MEDIA_MAX_PAGE_SIZE,
  );
  const search = escapedLikeSearch(options.search);
  const offset = (page - 1) * pageSize;
  const rows = await queryRows<EpisodeMediaRow>(
    `
      select
        track_id,
        title,
        publish_date,
        count(*) over() as total_count
      from public.episodes
      where track_id ~ '^(?:[0-9]+|sa_[0-9]+|wp-sermon:[0-9]+|cms_[a-z0-9][a-z0-9_-]{0,62})$'
        and (
          $1 = ''
          or title ilike ('%' || $1 || '%') escape '\\'
          or track_id ilike ('%' || $1 || '%') escape '\\'
          or coalesce(publish_date, '') ilike ('%' || $1 || '%') escape '\\'
        )
      order by updated_at desc, track_id desc
      limit $2
      offset $3
    `,
    [search, pageSize, offset],
  );
  const items = rows.flatMap((row) => {
    const item = mediaItem(row);
    return item ? [item] : [];
  });
  const total = Number(rows[0]?.total_count || 0);

  return {
    items,
    pagination: {
      page,
      pageSize,
      pageCount: total > 0 ? Math.ceil(total / pageSize) : 0,
      total,
    },
  };
}

export async function getCanonicalEpisodeMedia(trackId: string): Promise<CanonicalEpisodeMediaItem | null> {
  if (!isPublicEpisodeTrackId(trackId)) return null;
  const rows = await queryRows<EpisodeMediaRow>(
    `
      select track_id, title, publish_date, 1 as total_count
      from public.episodes
      where track_id = $1
      limit 1
    `,
    [trackId],
  );
  return rows[0] ? mediaItem(rows[0]) : null;
}

export async function assertCanonicalEpisodeMediaSelection(trackId: string) {
  const item = await getCanonicalEpisodeMedia(trackId);
  if (!item) {
    throw new Error("The selected canonical episode audio is no longer available.");
  }
  return item;
}
