import "server-only";

import { listAllProjectedContent } from "@/lib/public-content-projection";
import { STRAPI_PAGES_CACHE_TAG } from "@/lib/strapi";
import { fetchStrapiJsonResult } from "@/lib/strapi-request";

export type PublishedPageSitemapEntry = {
  documentId: string;
  slug: string;
  pageKey: string;
  canonicalUrl: string;
  noIndex: boolean;
};

export type PublishedPageSitemapListing = {
  entries: PublishedPageSitemapEntry[];
  source: "live" | "projection" | "unavailable";
};

type StrapiPageEntity = {
  documentId?: unknown;
  slug?: unknown;
  pageKey?: unknown;
  canonicalUrl?: unknown;
  noIndex?: unknown;
  attributes?: Record<string, unknown>;
};

type StrapiPageResponse = {
  data?: StrapiPageEntity[];
  meta?: { pagination?: { pageCount?: number } };
};

const PAGE_SIZE = 100;

function strapiBaseUrl() {
  return (process.env.STRAPI_PUBLIC_URL?.trim() || process.env.STRAPI_URL?.trim() || "").replace(/\/+$/, "");
}

function normalizePage(entity: StrapiPageEntity | Record<string, unknown>): PublishedPageSitemapEntry | null {
  const attributes = entity.attributes && typeof entity.attributes === "object" ? entity.attributes : {};
  const source = { ...attributes, ...entity } as Record<string, unknown>;
  const documentId = typeof source.documentId === "string" ? source.documentId : "";
  const slug = typeof source.slug === "string" ? source.slug.trim().toLowerCase() : "";
  const pageKey = typeof source.pageKey === "string" ? source.pageKey.trim().toLowerCase() : "";
  if (!documentId || !slug || !pageKey) return null;
  return {
    documentId,
    slug,
    pageKey,
    canonicalUrl: typeof source.canonicalUrl === "string" ? source.canonicalUrl.trim() : "",
    noIndex: source.noIndex === true,
  };
}

async function projectedPages() {
  try {
    const projection = await listAllProjectedContent<Record<string, unknown>>("page");
    const entries = projection.items.flatMap((item) => {
      const page = normalizePage(item);
      return page && item.active !== false ? [page] : [];
    });
    return {
      entries,
      source: projection.hasState ? "projection" : "unavailable",
    } satisfies PublishedPageSitemapListing;
  } catch (error) {
    console.error("Projected page sitemap lookup failed.", error);
    return { entries: [], source: "unavailable" } satisfies PublishedPageSitemapListing;
  }
}

export async function getPublishedPageSitemapListing(): Promise<PublishedPageSitemapListing> {
  const baseUrl = strapiBaseUrl();
  if (!baseUrl) return projectedPages();
  const token = process.env.STRAPI_READ_TOKEN?.trim() || process.env.STRAPI_API_TOKEN?.trim() || "";
  const pages: PublishedPageSitemapEntry[] = [];

  for (let page = 1; page <= 10_000; page += 1) {
    let url: URL;
    try {
      url = new URL("/api/pages", baseUrl);
    } catch {
      return projectedPages();
    }
    url.searchParams.set("filters[active][$eq]", "true");
    url.searchParams.set("filters[archivedAt][$null]", "true");
    url.searchParams.set("status", "published");
    for (const [index, field] of ["documentId", "slug", "pageKey", "canonicalUrl", "noIndex"].entries()) {
      url.searchParams.set(`fields[${index}]`, field);
    }
    url.searchParams.set("pagination[page]", String(page));
    url.searchParams.set("pagination[pageSize]", String(PAGE_SIZE));
    url.searchParams.set("sort", "slug:asc");

    const result = await fetchStrapiJsonResult<StrapiPageResponse>(
      url,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        next: { revalidate: 300, tags: [STRAPI_PAGES_CACHE_TAG] },
      },
      { label: "Published Strapi page sitemap request" },
    );
    if (result.status === "unavailable") return projectedPages();
    const entities = result.data?.data;
    if (!Array.isArray(entities)) return projectedPages();
    const normalized = entities.map(normalizePage);
    if (normalized.some((item) => !item)) return projectedPages();
    pages.push(...normalized as PublishedPageSitemapEntry[]);

    const pageCount = Number(result.data.meta?.pagination?.pageCount) || 0;
    if ((pageCount > 0 && page >= pageCount) || (pageCount === 0 && entities.length < PAGE_SIZE)) break;
  }
  return { entries: pages, source: "live" };
}

export async function listAllPublishedPageSitemapEntries(): Promise<PublishedPageSitemapEntry[]> {
  return (await getPublishedPageSitemapListing()).entries;
}

export async function listAllPublishedPageSlugs(): Promise<string[]> {
  return [...new Set((await listAllPublishedPageSitemapEntries()).filter((page) => !page.noIndex).map((page) => page.slug))].sort();
}
