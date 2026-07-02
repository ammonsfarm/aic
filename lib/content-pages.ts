import "server-only";

import { queryRows } from "@/lib/db";

export type ContentStatus = "Draft" | "Scheduled" | "Published" | "Archived";

export type ContentPageSummary = {
  id: number;
  slug: string;
  title: string;
  pageType: string;
  status: ContentStatus;
  updatedAt: string;
};

type ContentPageRow = {
  id: string | number;
  slug: string;
  title: string;
  page_type: string;
  status: ContentStatus;
  updated_at: string;
};

function toNumber(value: string | number) {
  return typeof value === "number" ? value : Number(value);
}

function mapPage(row: ContentPageRow): ContentPageSummary {
  return {
    id: toNumber(row.id),
    slug: row.slug,
    title: row.title,
    pageType: row.page_type,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

export async function listContentPages(): Promise<ContentPageSummary[]> {
  const rows = await queryRows<ContentPageRow>(
    `
      select id, slug, title, page_type, status, updated_at::text
      from content_pages
      order by page_type, title
    `,
  );

  return rows.map(mapPage);
}

export async function getContentPageBySlug(slug: string): Promise<ContentPageSummary | null> {
  const rows = await queryRows<ContentPageRow>(
    `
      select id, slug, title, page_type, status, updated_at::text
      from content_pages
      where slug = $1
      limit 1
    `,
    [slug],
  );

  return rows[0] ? mapPage(rows[0]) : null;
}

export async function getPublishedContentPage(slug: string): Promise<ContentPageSummary | null> {
  const page = await getContentPageBySlug(slug);
  return page?.status === "Published" ? page : null;
}
