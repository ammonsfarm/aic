import "server-only";

import { queryRows } from "@/lib/db";

export type ContentStatus = "Draft" | "Scheduled" | "Published" | "Archived";

export type ContentPageRevision = {
  id: number;
  pageId: number;
  revisionNumber: number;
  title: string;
  seoTitle: string;
  seoDescription: string;
  heroTitle: string;
  heroBody: string;
  bodyJson: unknown;
  bodyHtml: string;
  status: ContentStatus;
  createdBy: string;
  createdAt: string;
  changeNote: string;
};

export type ContentPageSummary = {
  id: number;
  slug: string;
  title: string;
  pageType: string;
  status: ContentStatus;
  updatedAt: string;
};

export type ContentPageDetail = ContentPageSummary & {
  publishedRevisionId: number | null;
  publishedAt: string | null;
  scheduledFor: string | null;
  revision: ContentPageRevision | null;
};

type ContentPageRow = {
  id: string | number;
  slug: string;
  title: string;
  page_type: string;
  status: ContentStatus;
  published_revision_id: string | number | null;
  updated_at: string;
  published_at: string | null;
  scheduled_for: string | null;
};

type ContentPageRevisionRow = {
  id: string | number;
  page_id: string | number;
  revision_number: string | number;
  title: string;
  seo_title: string;
  seo_description: string;
  hero_title: string;
  hero_body: string;
  body_json: unknown;
  body_html: string;
  status: ContentStatus;
  created_by: string;
  created_at: string;
  change_note: string;
};

function toNumber(value: string | number | null) {
  if (value === null) {
    return null;
  }

  return typeof value === "number" ? value : Number(value);
}

function mapRevision(row: ContentPageRevisionRow): ContentPageRevision {
  return {
    id: toNumber(row.id) ?? 0,
    pageId: toNumber(row.page_id) ?? 0,
    revisionNumber: toNumber(row.revision_number) ?? 0,
    title: row.title,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    heroTitle: row.hero_title,
    heroBody: row.hero_body,
    bodyJson: row.body_json,
    bodyHtml: row.body_html,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    changeNote: row.change_note,
  };
}

function mapPage(row: ContentPageRow): ContentPageSummary {
  return {
    id: toNumber(row.id) ?? 0,
    slug: row.slug,
    title: row.title,
    pageType: row.page_type,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function mapPageDetail(row: ContentPageRow, revision: ContentPageRevision | null): ContentPageDetail {
  return {
    ...mapPage(row),
    publishedRevisionId: toNumber(row.published_revision_id),
    publishedAt: row.published_at,
    scheduledFor: row.scheduled_for,
    revision,
  };
}

export async function listContentPages(): Promise<ContentPageSummary[]> {
  const rows = await queryRows<ContentPageRow>(
    `
      select id, slug, title, page_type, status, published_revision_id, updated_at::text, published_at::text, scheduled_for::text
      from content_pages
      order by page_type, title
    `,
  );

  return rows.map(mapPage);
}

export async function getContentPageById(id: number): Promise<ContentPageDetail | null> {
  const rows = await queryRows<ContentPageRow>(
    `
      select id, slug, title, page_type, status, published_revision_id, updated_at::text, published_at::text, scheduled_for::text
      from content_pages
      where id = $1
      limit 1
    `,
    [id],
  );

  const page = rows[0];
  if (!page) {
    return null;
  }

  const revisionId = toNumber(page.published_revision_id);
  const revision = revisionId ? await getContentPageRevision(revisionId) : null;
  return mapPageDetail(page, revision);
}

export async function getContentPageBySlug(slug: string): Promise<ContentPageDetail | null> {
  const rows = await queryRows<ContentPageRow>(
    `
      select id, slug, title, page_type, status, published_revision_id, updated_at::text, published_at::text, scheduled_for::text
      from content_pages
      where slug = $1
      limit 1
    `,
    [slug],
  );

  const page = rows[0];
  if (!page) {
    return null;
  }

  const revisionId = toNumber(page.published_revision_id);
  const revision = revisionId ? await getContentPageRevision(revisionId) : null;
  return mapPageDetail(page, revision);
}

export async function getPublishedContentPage(slug: string): Promise<ContentPageDetail | null> {
  const page = await getContentPageBySlug(slug);
  if (!page || page.status !== "Published" || !page.revision || page.revision.status !== "Published") {
    return null;
  }

  return page;
}

async function getContentPageRevision(id: number): Promise<ContentPageRevision | null> {
  const rows = await queryRows<ContentPageRevisionRow>(
    `
      select id, page_id, revision_number, title, seo_title, seo_description, hero_title, hero_body, body_json, body_html, status, created_by, created_at::text, change_note
      from content_page_revisions
      where id = $1
      limit 1
    `,
    [id],
  );

  return rows[0] ? mapRevision(rows[0]) : null;
}
