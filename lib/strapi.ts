import "server-only";

import { cmsMediaPublicUrl } from "@/lib/cms-media-url";
import { fetchStrapiJsonResult } from "@/lib/strapi-request";

export type StrapiMedia = {
  id?: number;
  url: string;
  alternativeText: string;
  name: string;
};

export type StrapiPageSection = {
  id?: number;
  component: string;
  eyebrow: string;
  heading: string;
  body: string;
  buttonLabel: string;
  buttonUrl: string;
  imageSide: "none" | "left" | "right" | "";
  imageDescription: string;
  image: StrapiMedia | null;
};

export type StrapiPage = {
  pageKey: string;
  slug: string;
  title: string;
  active: boolean;
  showInNavigation: boolean;
  navigationLabel: string;
  navigationOrder: number | null;
  heroLabel: string;
  heroTitle: string;
  heroBody: string;
  seoTitle: string;
  seoDescription: string;
  sections: StrapiPageSection[];
};

export type StrapiPageLookupResult =
  | { status: "found"; page: StrapiPage }
  | { status: "not-found" }
  | { status: "unavailable" };

type StrapiEntity<T> = {
  id?: number;
  documentId?: string;
  attributes?: Partial<T>;
} & Partial<T>;

type StrapiListResponse<T> = {
  data?: Array<StrapiEntity<T>>;
};

export const STRAPI_PAGES_CACHE_TAG = "strapi:pages";
export const DEFAULT_STRAPI_PAGE_REVALIDATE_SECONDS = 60 * 60;

export function strapiPageCacheTag(identifier: string) {
  return `strapi:page:${identifier.trim().toLowerCase()}`;
}

function strapiPageRevalidateSeconds() {
  const value = Number(process.env.STRAPI_PAGE_REVALIDATE_SECONDS ?? DEFAULT_STRAPI_PAGE_REVALIDATE_SECONDS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_STRAPI_PAGE_REVALIDATE_SECONDS;
}

function strapiBaseUrl() {
  return process.env.STRAPI_URL?.replace(/\/+$/, "") || "";
}

function strapiApiToken() {
  return process.env.STRAPI_API_TOKEN?.trim() || "";
}

function getString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function getBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeMedia(media: unknown): StrapiMedia | null {
  if (!media || typeof media !== "object") {
    return null;
  }

  const entity = media as Record<string, unknown>;
  const source = entity.attributes && typeof entity.attributes === "object"
    ? { ...(entity.attributes as Record<string, unknown>), ...entity }
    : entity;
  const rawUrl = getString(source.url);

  if (!rawUrl) {
    return null;
  }

  const url = cmsMediaPublicUrl(source);

  if (!url) {
    return null;
  }

  return {
    id: typeof entity.id === "number" ? entity.id : undefined,
    url,
    alternativeText: getString(source.alternativeText),
    name: getString(source.name),
  };
}

function normalizePageSection(section: unknown): StrapiPageSection | null {
  if (!section || typeof section !== "object") {
    return null;
  }

  const source = section as Record<string, unknown>;
  const imageSide = getString(source.imageSide);

  return {
    id: typeof source.id === "number" ? source.id : undefined,
    component: getString(source.__component),
    eyebrow: getString(source.eyebrow),
    heading: getString(source.heading),
    body: getString(source.body),
    buttonLabel: getString(source.buttonLabel),
    buttonUrl: getString(source.buttonUrl),
    imageSide: imageSide === "none" || imageSide === "left" || imageSide === "right" ? imageSide : "",
    imageDescription: getString(source.imageDescription),
    image: normalizeMedia(source.image),
  };
}

function normalizePage(entity: StrapiEntity<StrapiPage>): StrapiPage | null {
  const source = entity.attributes ?? entity;
  const pageKey = getString(source.pageKey);
  const slug = getString(source.slug);
  const title = getString(source.title);

  if (!pageKey || !slug || !title) {
    return null;
  }

  const rawSections = Array.isArray(source.sections) ? source.sections : [];

  return {
    pageKey,
    slug,
    title,
    active: getBoolean(source.active, true),
    showInNavigation: getBoolean(source.showInNavigation),
    navigationLabel: getString(source.navigationLabel),
    navigationOrder: getNumber(source.navigationOrder),
    heroLabel: getString(source.heroLabel),
    heroTitle: getString(source.heroTitle),
    heroBody: getString(source.heroBody),
    seoTitle: getString(source.seoTitle),
    seoDescription: getString(source.seoDescription),
    sections: rawSections.flatMap((section) => {
      const normalized = normalizePageSection(section);
      return normalized ? [normalized] : [];
    }),
  };
}

async function fetchStrapiPagesResult(url: URL, tags: string[]): Promise<StrapiPageLookupResult> {
  const token = strapiApiToken();
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const result = await fetchStrapiJsonResult<StrapiListResponse<StrapiPage>>(
    url,
    {
      headers,
      next: {
        revalidate: strapiPageRevalidateSeconds(),
        tags,
      },
    },
    { label: "Strapi page request" },
  );

  if (result.status === "unavailable") return result;
  const payload = result.data;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.data)) {
    console.warn("Strapi page request returned an invalid list payload; using the non-Strapi fallback.");
    return { status: "unavailable" };
  }

  if (payload.data.length === 0) return { status: "not-found" };
  const entity = payload.data[0];
  if (!entity || typeof entity !== "object") {
    console.warn("Strapi page request returned an invalid page entity; using the non-Strapi fallback.");
    return { status: "unavailable" };
  }
  const page = normalizePage(entity);
  if (!page) {
    console.warn("Strapi page request returned an invalid page entity; using the non-Strapi fallback.");
    return { status: "unavailable" };
  }
  return page.active ? { status: "found", page } : { status: "not-found" };
}

async function fetchStrapiPages(url: URL, tags: string[]): Promise<StrapiPage | null> {
  const result = await fetchStrapiPagesResult(url, tags);
  return result.status === "found" ? result.page : null;
}

export async function getStrapiPageByPageKey(pageKey: string): Promise<StrapiPage | null> {
  const baseUrl = strapiBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const url = new URL("/api/pages", baseUrl);
  url.searchParams.set("filters[pageKey][$eq]", pageKey);
  url.searchParams.set("filters[active][$eq]", "true");
  url.searchParams.set("filters[archivedAt][$null]", "true");
  url.searchParams.set("status", "published");
  url.searchParams.set("pagination[pageSize]", "1");
  url.searchParams.set("populate[sections][populate]", "*");

  return fetchStrapiPages(url, [STRAPI_PAGES_CACHE_TAG, strapiPageCacheTag(pageKey)]);
}

export async function getStrapiPageBySlug(slug: string): Promise<StrapiPage | null> {
  const result = await getStrapiPageBySlugResult(slug);
  return result.status === "found" ? result.page : null;
}

export async function getStrapiPageBySlugResult(slug: string): Promise<StrapiPageLookupResult> {
  const baseUrl = strapiBaseUrl();
  if (!baseUrl) {
    return { status: "unavailable" };
  }

  let url: URL;
  try {
    url = new URL("/api/pages", baseUrl);
  } catch {
    return { status: "unavailable" };
  }
  url.searchParams.set("filters[slug][$eq]", slug);
  url.searchParams.set("filters[active][$eq]", "true");
  url.searchParams.set("filters[archivedAt][$null]", "true");
  url.searchParams.set("status", "published");
  url.searchParams.set("pagination[pageSize]", "1");
  url.searchParams.set("populate[sections][populate]", "*");

  return fetchStrapiPagesResult(url, [STRAPI_PAGES_CACHE_TAG, strapiPageCacheTag(slug)]);
}
