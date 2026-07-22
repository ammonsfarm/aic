import "server-only";

import { STRAPI_PAGES_CACHE_TAG } from "@/lib/strapi";
import { fetchStrapiJsonOrNull } from "@/lib/strapi-request";

type StrapiPageSlugEntity = {
  slug?: unknown;
  attributes?: { slug?: unknown };
};

type StrapiPageSlugResponse = {
  data?: StrapiPageSlugEntity[];
  meta?: { pagination?: { pageCount?: number } };
};

const PAGE_SIZE = 250;

function strapiBaseUrl() {
  return (process.env.STRAPI_PUBLIC_URL?.trim() || process.env.STRAPI_URL?.trim() || "").replace(/\/+$/, "");
}

function pageSlug(entity: StrapiPageSlugEntity) {
  const value = entity.attributes?.slug ?? entity.slug;
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export async function listAllPublishedPageSlugs(): Promise<string[]> {
  const baseUrl = strapiBaseUrl();
  if (!baseUrl) return [];

  const token = process.env.STRAPI_READ_TOKEN?.trim() || process.env.STRAPI_API_TOKEN?.trim() || "";
  const slugs = new Set<string>();

  for (let page = 1; page <= 10_000; page += 1) {
    let url: URL;
    try {
      url = new URL("/api/pages", baseUrl);
    } catch {
      return [];
    }
    url.searchParams.set("filters[active][$eq]", "true");
    url.searchParams.set("filters[archivedAt][$null]", "true");
    url.searchParams.set("status", "published");
    url.searchParams.set("fields[0]", "slug");
    url.searchParams.set("pagination[page]", String(page));
    url.searchParams.set("pagination[pageSize]", String(PAGE_SIZE));
    url.searchParams.set("sort", "slug:asc");

    const payload = await fetchStrapiJsonOrNull<StrapiPageSlugResponse>(
      url,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        next: { revalidate: 300, tags: [STRAPI_PAGES_CACHE_TAG] },
      },
      { label: "Published Strapi page sitemap request" },
    );
    if (!payload) return [];

    const entities = payload.data ?? [];
    for (const entity of entities) {
      const slug = pageSlug(entity);
      if (slug) slugs.add(slug);
    }

    const pageCount = Number(payload.meta?.pagination?.pageCount) || 0;
    if ((pageCount > 0 && page >= pageCount) || (pageCount === 0 && entities.length < PAGE_SIZE)) break;
  }

  return [...slugs].sort();
}
