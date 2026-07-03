import "server-only";

import { STRAPI_PAGES_CACHE_TAG, strapiPageCacheTag } from "@/lib/strapi";

export const STRAPI_SITE_SETTINGS_CACHE_TAG = "strapi:site-settings";

export type StrapiNavigationItem = {
  id?: number;
  label: string;
  href: string;
  order: number | null;
  active: boolean;
  external: boolean;
};

export type StrapiSiteSettings = {
  siteName: string;
  topNavigation: StrapiNavigationItem[];
  footerNavigation: StrapiNavigationItem[];
  utilityNavigation: StrapiNavigationItem[];
  footerText: string;
  copyrightText: string;
  showDonateButton: boolean;
  donateButtonLabel: string;
  donateButtonUrl: string;
};

type StrapiEntity<T> = {
  id?: number;
  documentId?: string;
  attributes?: Partial<T>;
} & Partial<T>;

type StrapiSingleResponse<T> = {
  data?: StrapiEntity<T>;
};

function strapiBaseUrl() {
  return process.env.STRAPI_URL?.replace(/\/+$/, "") || "";
}

function strapiApiToken() {
  return process.env.STRAPI_API_TOKEN?.trim() || "";
}

function strapiPageRevalidateSeconds() {
  const value = Number(process.env.STRAPI_PAGE_REVALIDATE_SECONDS ?? 60 * 60);
  return Number.isFinite(value) && value > 0 ? value : 60 * 60;
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pageHref(page: unknown) {
  const entity = asRecord(page);
  const source = asRecord(entity.attributes ?? entity);
  const pageKey = getString(source.pageKey);
  const slug = getString(source.slug);

  if (pageKey === "about") {
    return "/about-pastor-wood/";
  }

  if (pageKey === "home" || slug === "home") {
    return "/";
  }

  return slug ? `/${slug.replace(/^\/+/, "")}/` : "";
}

function normalizeNavigationItem(item: unknown): StrapiNavigationItem | null {
  const source = asRecord(item);
  const label = getString(source.label);
  const explicitUrl = getString(source.url);
  const linkedPageHref = pageHref(source.page);
  const href = linkedPageHref || explicitUrl;

  if (!label || !href) {
    return null;
  }

  return {
    id: typeof source.id === "number" ? source.id : undefined,
    label,
    href,
    order: getNumber(source.order),
    active: getBoolean(source.active, true),
    external: href.startsWith("http"),
  };
}

function normalizeNavigation(items: unknown) {
  return (Array.isArray(items) ? items : [])
    .flatMap((item) => {
      const normalized = normalizeNavigationItem(item);
      return normalized ? [normalized] : [];
    })
    .filter((item) => item.active);
}

function normalizeSettings(entity: StrapiEntity<StrapiSiteSettings>): StrapiSiteSettings | null {
  const source = asRecord(entity.attributes ?? entity);
  const siteName = getString(source.siteName) || "Abiding in Christ";

  return {
    siteName,
    topNavigation: normalizeNavigation(source.topNavigation),
    footerNavigation: normalizeNavigation(source.footerNavigation),
    utilityNavigation: normalizeNavigation(source.utilityNavigation),
    footerText: getString(source.footerText),
    copyrightText: getString(source.copyrightText),
    showDonateButton: getBoolean(source.showDonateButton, true),
    donateButtonLabel: getString(source.donateButtonLabel) || "Donate",
    donateButtonUrl: getString(source.donateButtonUrl) || "/donate/",
  };
}

export async function getStrapiSiteSettings(): Promise<StrapiSiteSettings | null> {
  const baseUrl = strapiBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const token = strapiApiToken();
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const url = new URL("/api/site-setting", baseUrl);
  url.searchParams.set("status", "published");
  url.searchParams.set("populate[topNavigation][populate]", "page");
  url.searchParams.set("populate[footerNavigation][populate]", "page");
  url.searchParams.set("populate[utilityNavigation][populate]", "page");

  const response = await fetch(url, {
    headers,
    next: {
      revalidate: strapiPageRevalidateSeconds(),
      tags: [STRAPI_SITE_SETTINGS_CACHE_TAG, STRAPI_PAGES_CACHE_TAG, strapiPageCacheTag("site-settings")],
    },
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    console.warn(`Strapi site settings request failed with ${response.status}. Falling back.`, details.slice(0, 500));
    return null;
  }

  const payload = (await response.json()) as StrapiSingleResponse<StrapiSiteSettings>;
  return payload.data ? normalizeSettings(payload.data) : null;
}
