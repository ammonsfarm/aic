import "server-only";

import { cmsMediaPublicUrl } from "@/lib/cms-media-url";
import { STRAPI_PAGES_CACHE_TAG, strapiPageCacheTag } from "@/lib/strapi";
import { fetchStrapiJsonOrNull } from "@/lib/strapi-request";
import { safeCmsHref } from "@/lib/cms-html";
import { subscriptionProviderConfigReady } from "@/lib/subscription-provider-config";

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
  donorDashboardUrl: string;
  headerLogo: {
    url: string;
    alternativeText: string;
    name: string;
  } | null;
  subscriptionEnabled: boolean;
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
  const href = safeCmsHref(linkedPageHref || explicitUrl);

  if (!label || !href) {
    return null;
  }

  return {
    id: typeof source.id === "number" ? source.id : undefined,
    label,
    href,
    order: getNumber(source.order),
    active: getBoolean(source.active, true),
    external: href.startsWith("https://") || href.startsWith("mailto:") || href.startsWith("tel:"),
  };
}

function normalizeNavigation(items: unknown) {
  return (Array.isArray(items) ? items : [])
    .flatMap((item) => {
      const normalized = normalizeNavigationItem(item);
      return normalized ? [normalized] : [];
    })
    .filter((item) => item.active)
    .sort((left, right) => (left.order ?? 9999) - (right.order ?? 9999));
}

function normalizeSettings(entity: StrapiEntity<StrapiSiteSettings>): StrapiSiteSettings | null {
  const source = asRecord(entity.attributes ?? entity);
  const siteName = getString(source.siteName) || "Abiding in Christ";
  const headerLogoSource = asRecord(asRecord(source.headerLogo).attributes ?? source.headerLogo);
  const headerLogoUrl = cmsMediaPublicUrl(source.headerLogo);

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
    donorDashboardUrl: getString(source.donorDashboardUrl) || "https://www.pastorwood.org/donor-dashboard/",
    headerLogo: headerLogoUrl ? {
      url: headerLogoUrl,
      alternativeText: getString(headerLogoSource.alternativeText),
      name: getString(headerLogoSource.name),
    } : null,
    subscriptionEnabled: getBoolean(source.subscriptionEnabled, false) && subscriptionProviderConfigReady(),
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
  url.searchParams.set("populate[headerLogo]", "*");

  const payload = await fetchStrapiJsonOrNull<StrapiSingleResponse<StrapiSiteSettings>>(
    url,
    {
      headers,
      next: {
        revalidate: strapiPageRevalidateSeconds(),
        tags: [STRAPI_SITE_SETTINGS_CACHE_TAG, STRAPI_PAGES_CACHE_TAG, strapiPageCacheTag("site-settings")],
      },
    },
    { label: "Strapi site settings request" },
  );

  if (!payload) {
    return null;
  }

  return payload.data ? normalizeSettings(payload.data) : null;
}
