import "server-only";

import { cmsMediaPublicUrl } from "@/lib/cms-media-url";
import { getProjectedContentByIdentity } from "@/lib/public-content-projection";
import { STRAPI_PAGES_CACHE_TAG, strapiPageCacheTag } from "@/lib/strapi";
import { fetchStrapiJsonResult } from "@/lib/strapi-request";
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
  /** Raw published CMS switch before provider configuration is considered. */
  subscriptionPublishedEnabled: boolean;
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
  if (source.active === false || getString(source.archivedAt)) return "";
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
  const pageEntity = asRecord(source.page);
  const pageSource = asRecord(pageEntity.attributes ?? pageEntity);
  const pageDocumentId = getString(pageSource.documentId) || getString(pageEntity.documentId);
  const linkedPageHref = pageHref(source.page);
  const href = safeCmsHref(linkedPageHref || (pageDocumentId ? "" : explicitUrl));

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
  const subscriptionPublishedEnabled = getBoolean(source.subscriptionEnabled, false);

  return {
    siteName,
    topNavigation: normalizeNavigation(source.topNavigation),
    footerNavigation: normalizeNavigation(source.footerNavigation),
    utilityNavigation: normalizeNavigation(source.utilityNavigation),
    footerText: getString(source.footerText),
    copyrightText: getString(source.copyrightText),
    showDonateButton: getBoolean(source.showDonateButton, true),
    donateButtonLabel: getString(source.donateButtonLabel) || "Donate",
    donateButtonUrl: getString(source.donateButtonUrl),
    donorDashboardUrl: getString(source.donorDashboardUrl),
    headerLogo: headerLogoUrl ? {
      url: headerLogoUrl,
      alternativeText: getString(headerLogoSource.alternativeText),
      name: getString(headerLogoSource.name),
    } : null,
    subscriptionPublishedEnabled,
    subscriptionEnabled: subscriptionPublishedEnabled && subscriptionProviderConfigReady(),
  };
}

function unpublishedSettings(): StrapiSiteSettings {
  return {
    siteName: "Abiding in Christ",
    topNavigation: [],
    footerNavigation: [],
    utilityNavigation: [],
    footerText: "",
    copyrightText: "",
    showDonateButton: false,
    donateButtonLabel: "Donate",
    donateButtonUrl: "",
    donorDashboardUrl: "",
    headerLogo: null,
    subscriptionPublishedEnabled: false,
    subscriptionEnabled: false,
  };
}

async function projectedSettings() {
  try {
    const projection = await getProjectedContentByIdentity<Record<string, unknown>>(
      "site-setting",
      "singleton",
      "site-setting",
    );
    if (projection.status === "found") {
      return normalizeSettings(projection.item as StrapiEntity<StrapiSiteSettings>) || unpublishedSettings();
    }
    return projection.status === "not-found" ? unpublishedSettings() : null;
  } catch (error) {
    console.error("Projected site settings lookup failed.", error);
    return null;
  }
}

export async function getStrapiSiteSettings(): Promise<StrapiSiteSettings | null> {
  const baseUrl = strapiBaseUrl();
  if (!baseUrl) {
    return projectedSettings();
  }

  const token = strapiApiToken();
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const url = new URL("/api/site-setting", baseUrl);
  url.searchParams.set("status", "published");
  url.searchParams.set("populate[topNavigation][populate]", "page");
  url.searchParams.set("populate[footerNavigation][populate]", "page");
  url.searchParams.set("populate[utilityNavigation][populate]", "page");
  url.searchParams.set("populate[headerLogo]", "*");

  const result = await fetchStrapiJsonResult<StrapiSingleResponse<StrapiSiteSettings>>(
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

  if (result.status === "unavailable") return projectedSettings();
  const payload = result.data;
  if (!payload?.data) return unpublishedSettings();
  return normalizeSettings(payload.data);
}
