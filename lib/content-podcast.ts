import "server-only";

import { queryRows } from "@/lib/db";
import type { ContentStatus } from "@/lib/content-pages";

export type ProcessingStatus = "Not Requested" | "Queued" | "Running" | "Completed" | "Failed" | "Skipped";

export type ContentPodcastUploadSummary = {
  id: number;
  trackId: string | null;
  slug: string;
  title: string;
  status: ContentStatus;
  publishDate: string | null;
  transcriptStatus: ProcessingStatus;
  intelligenceStatus: ProcessingStatus;
  vectorStatus: ProcessingStatus;
  updatedAt: string;
};

type ContentPodcastUploadRow = {
  id: string | number;
  track_id: string | null;
  slug: string;
  title: string;
  status: ContentStatus;
  publish_date: string | null;
  transcript_status: ProcessingStatus;
  intelligence_status: ProcessingStatus;
  vector_status: ProcessingStatus;
  updated_at: string;
};

function toNumber(value: string | number) {
  return typeof value === "number" ? value : Number(value);
}

function mapUpload(row: ContentPodcastUploadRow): ContentPodcastUploadSummary {
  return {
    id: toNumber(row.id),
    trackId: row.track_id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    publishDate: row.publish_date,
    transcriptStatus: row.transcript_status,
    intelligenceStatus: row.intelligence_status,
    vectorStatus: row.vector_status,
    updatedAt: row.updated_at,
  };
}

export async function listContentPodcastUploads(limit = 50): Promise<ContentPodcastUploadSummary[]> {
  const rows = await queryRows<ContentPodcastUploadRow>(
    `
      select
        id,
        track_id,
        slug,
        title,
        status,
        publish_date::text,
        transcript_status,
        intelligence_status,
        vector_status,
        updated_at::text
      from content_podcast_uploads
      order by coalesce(publish_date, created_at::date) desc, id desc
      limit $1
    `,
    [limit],
  );

  return rows.map(mapUpload);
}

export async function getContentPodcastUploadBySlug(slug: string): Promise<ContentPodcastUploadSummary | null> {
  const rows = await queryRows<ContentPodcastUploadRow>(
    `
      select
        id,
        track_id,
        slug,
        title,
        status,
        publish_date::text,
        transcript_status,
        intelligence_status,
        vector_status,
        updated_at::text
      from content_podcast_uploads
      where slug = $1
      limit 1
    `,
    [slug],
  );

  return rows[0] ? mapUpload(rows[0]) : null;
}
