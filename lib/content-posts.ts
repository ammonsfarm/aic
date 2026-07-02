import "server-only";

import { queryRows } from "@/lib/db";
import type { ContentStatus } from "@/lib/content-pages";

export type ContentPostSummary = {
  id: number;
  slug: string;
  title: string;
  sourceType: string;
  status: ContentStatus;
  publishDate: string | null;
  updatedAt: string;
};

type ContentPostRow = {
  id: string | number;
  slug: string;
  title: string;
  source_type: string;
  status: ContentStatus;
  publish_date: string | null;
  updated_at: string;
};

function toNumber(value: string | number) {
  return typeof value === "number" ? value : Number(value);
}

function mapPost(row: ContentPostRow): ContentPostSummary {
  return {
    id: toNumber(row.id),
    slug: row.slug,
    title: row.title,
    sourceType: row.source_type,
    status: row.status,
    publishDate: row.publish_date,
    updatedAt: row.updated_at,
  };
}

export async function listContentPosts(limit = 50): Promise<ContentPostSummary[]> {
  const rows = await queryRows<ContentPostRow>(
    `
      select id, slug, title, source_type, status, publish_date::text, updated_at::text
      from content_posts
      order by coalesce(publish_date, created_at::date) desc, id desc
      limit $1
    `,
    [limit],
  );

  return rows.map(mapPost);
}

export async function getContentPostBySlug(slug: string): Promise<ContentPostSummary | null> {
  const rows = await queryRows<ContentPostRow>(
    `
      select id, slug, title, source_type, status, publish_date::text, updated_at::text
      from content_posts
      where slug = $1
      limit 1
    `,
    [slug],
  );

  return rows[0] ? mapPost(rows[0]) : null;
}

export async function getPublishedContentPost(slug: string): Promise<ContentPostSummary | null> {
  const post = await getContentPostBySlug(slug);
  return post?.status === "Published" ? post : null;
}
