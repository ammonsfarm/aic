import "server-only";

import { queryRows } from "@/lib/db";
import type { ContentStatus } from "@/lib/content-pages";

export type ContentNewsletterSummary = {
  id: number;
  slug: string;
  title: string;
  subject: string;
  status: ContentStatus;
  updatedAt: string;
};

type ContentNewsletterRow = {
  id: string | number;
  slug: string;
  title: string;
  subject: string;
  status: ContentStatus;
  updated_at: string;
};

function toNumber(value: string | number) {
  return typeof value === "number" ? value : Number(value);
}

function mapNewsletter(row: ContentNewsletterRow): ContentNewsletterSummary {
  return {
    id: toNumber(row.id),
    slug: row.slug,
    title: row.title,
    subject: row.subject,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

export async function listContentNewsletters(limit = 50): Promise<ContentNewsletterSummary[]> {
  const rows = await queryRows<ContentNewsletterRow>(
    `
      select id, slug, title, subject, status, updated_at::text
      from content_newsletters
      order by created_at desc, id desc
      limit $1
    `,
    [limit],
  );

  return rows.map(mapNewsletter);
}

export async function getContentNewsletterBySlug(slug: string): Promise<ContentNewsletterSummary | null> {
  const rows = await queryRows<ContentNewsletterRow>(
    `
      select id, slug, title, subject, status, updated_at::text
      from content_newsletters
      where slug = $1
      limit 1
    `,
    [slug],
  );

  return rows[0] ? mapNewsletter(rows[0]) : null;
}
