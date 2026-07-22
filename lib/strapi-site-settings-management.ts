import "server-only";

import type { ManagedStrapiPage, StrapiPublicationStatus } from "@/lib/strapi-management";
import { fetchWithTimeout } from "@/lib/strapi-request";

type StrapiEntity<T> = {
  id?: number;
  documentId?: string;
  attributes?: Partial<T>;
} & Partial<T>;

type StrapiListResponse<T> = {
  data?: Array<StrapiEntity<T>>;
};

type StrapiSingleResponse<T> = {
  data?: StrapiEntity<T>;
};

export type ManagedNavigationItem = {
  id?: number;
  label: string;
  url: string;
  pageDocumentId: string;
  pageTitle: string;
  pageSlug: string;
  order: number | null;
  active: boolean;
};

export type ManagedSiteSettings = {
  id?: number;
  documentId: string;
  siteName: string;
  topNavigation: ManagedNavigationItem[];
  footerNavigation: ManagedNavigationItem[];
  utilityNavigation: ManagedNavigationItem[];
  footerText: string;
  copyrightText: string;
  showDonateButton: boolean;
  donateButtonLabel: string;
  donateButtonUrl: string;
  updatedAt: string;
  publishedAt: string;
  publicationStatus: StrapiPublicationStatus;
};

export type ManagedNavigationItemInput = {
  id?: number;
  label: string;
  url: string;
  pageDocumentId: string;
  order: number | null;
  active: boolean;
};

export type ManagedSiteSettingsInput = {
  siteName: string;
  topNavigation: ManagedNavigationItemInput[];
  footerNavigation: ManagedNavigationItemInput[];
  utilityNavigation: ManagedNavigationItemInput[];
  footerText: string;
  copyrightText: string;
  showDonateButton: boolean;
  donateButtonLabel: string;
  donateButtonUrl: string;
};

function strapiBaseUrl() {
  return process.env.STRAPI_URL?.replace(/\/+$/, "") || "";
}

function strapiWriteToken() {
  return process.env.STRAPI_API_TOKEN_TEMP_WRITE?.trim() || process.env.STRAPI_API_TOKEN?.trim() || "";
}

function headers(): HeadersInit {
  const token = strapiWriteToken();
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

function requireConfig() {
  const baseUrl = strapiBaseUrl();
  const token = strapiWriteToken();

  if (!baseUrl || !token) {
    throw new Error("Strapi site settings management is not configured. Set STRAPI_URL and STRAPI_API_TOKEN_TEMP_WRITE or STRAPI_API_TOKEN.");
  }

  return baseUrl;
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

async function strapiJson<T>(url: URL | string, init?: RequestInit): Promise<T> {
  const response = await fetchWithTimeout(url, {
    ...init,
    headers: {
      ...headers(),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Strapi request failed with ${response.status}: ${text.slice(0, 500)}`);
  }

  return (text ? JSON.parse(text) : null) as T;
}

function normalizePageEntity(page: unknown) {
  const entity = asRecord(page);
  const source = asRecord(entity.attributes ?? entity);
  const id = typeof entity.id === "number" ? String(entity.id) : "";
  const documentId = getString(entity.documentId ?? source.documentId);

  return {
    relationValue: id || documentId,
    documentId,
    title: getString(source.title),
    slug: getString(source.slug),
  };
}

function normalizeNavigationItem(item: unknown): ManagedNavigationItem | null {
  const source = asRecord(item);
  const label = getString(source.label);
  const url = getString(source.url);
  const page = normalizePageEntity(source.page);

  if (!label && !url && !page.documentId) {
    return null;
  }

  return {
    id: typeof source.id === "number" ? source.id : undefined,
    label,
    url,
    pageDocumentId: page.relationValue,
    pageTitle: page.title,
    pageSlug: page.slug,
    order: getNumber(source.order),
    active: getBoolean(source.active, true),
  };
}

function normalizeNavigation(items: unknown) {
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    const normalized = normalizeNavigationItem(item);
    return normalized ? [normalized] : [];
  });
}

function normalizeSettings(entity: StrapiEntity<ManagedSiteSettings>): ManagedSiteSettings | null {
  const source = asRecord(entity.attributes ?? entity);
  const documentId = getString(entity.documentId ?? source.documentId);

  if (!documentId) {
    return null;
  }

  return {
    id: entity.id,
    documentId,
    siteName: getString(source.siteName) || "Abiding in Christ",
    topNavigation: normalizeNavigation(source.topNavigation),
    footerNavigation: normalizeNavigation(source.footerNavigation),
    utilityNavigation: normalizeNavigation(source.utilityNavigation),
    footerText: getString(source.footerText),
    copyrightText: getString(source.copyrightText),
    showDonateButton: getBoolean(source.showDonateButton, true),
    donateButtonLabel: getString(source.donateButtonLabel) || "Donate",
    donateButtonUrl: getString(source.donateButtonUrl) || "/donate",
    updatedAt: getString(source.updatedAt),
    publishedAt: getString(source.publishedAt),
    publicationStatus: getString(source.publishedAt) ? "published" : "draft",
  };
}

function normalizeManagedPage(entity: StrapiEntity<ManagedStrapiPage>): ManagedStrapiPage | null {
  const source = asRecord(entity.attributes ?? entity);
  const documentId = getString(entity.documentId ?? source.documentId);
  const title = getString(source.title);
  const slug = getString(source.slug);
  const pageKey = getString(source.pageKey);

  if (!documentId || (!title && !slug && !pageKey)) {
    return null;
  }

  return {
    id: entity.id,
    documentId,
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
    publishedAt: getString(source.publishedAt),
    updatedAt: getString(source.updatedAt),
    createdAt: getString(source.createdAt),
    sections: [],
    publicationStatus: getString(source.publishedAt) ? "published" : "draft",
  };
}

function navigationPayload(items: ManagedNavigationItemInput[]) {
  return items.map((item) => {
    const payload: Record<string, unknown> = {
      label: item.label,
      url: item.url,
      order: item.order,
      active: item.active,
    };

    if (item.id) {
      payload.id = item.id;
    }

    if (item.pageDocumentId) {
      const numericPageId = Number(item.pageDocumentId);
      payload.page = Number.isFinite(numericPageId) ? numericPageId : item.pageDocumentId;
    } else {
      payload.page = null;
    }

    return payload;
  });
}

function siteSettingsPayload(input: ManagedSiteSettingsInput) {
  return {
    data: {
      siteName: input.siteName,
      topNavigation: navigationPayload(input.topNavigation),
      footerNavigation: navigationPayload(input.footerNavigation),
      utilityNavigation: navigationPayload(input.utilityNavigation),
      footerText: input.footerText,
      copyrightText: input.copyrightText,
      showDonateButton: input.showDonateButton,
      donateButtonLabel: input.donateButtonLabel,
      donateButtonUrl: input.donateButtonUrl,
    },
  };
}

export async function getManagedSiteSettings() {
  const baseUrl = requireConfig();
  const createUrl = (status: StrapiPublicationStatus) => {
    const url = new URL("/api/site-setting", baseUrl);
    url.searchParams.set("status", status);
    url.searchParams.set("populate[topNavigation][populate]", "page");
    url.searchParams.set("populate[footerNavigation][populate]", "page");
    url.searchParams.set("populate[utilityNavigation][populate]", "page");
    return url;
  };

  const draftPayload = await strapiJson<StrapiSingleResponse<ManagedSiteSettings>>(createUrl("draft"));
  let publishedPayload: StrapiSingleResponse<ManagedSiteSettings> = {};
  try {
    publishedPayload = await strapiJson<StrapiSingleResponse<ManagedSiteSettings>>(createUrl("published"));
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("404")) {
      throw error;
    }
  }

  const settings = draftPayload.data ? normalizeSettings(draftPayload.data) : null;
  const publishedSettings = publishedPayload.data ? normalizeSettings(publishedPayload.data) : null;
  if (!settings && !publishedSettings) {
    return null;
  }

  const source = settings ?? publishedSettings!;
  return {
    ...source,
    publishedAt: publishedSettings?.publishedAt ?? "",
    publicationStatus: publishedSettings ? "published" as const : "draft" as const,
  };
}

export async function listSiteSettingsPageOptions() {
  const baseUrl = requireConfig();
  const url = new URL("/api/pages", baseUrl);
  url.searchParams.set("status", "draft");
  url.searchParams.set("pagination[pageSize]", "100");
  url.searchParams.set("sort[0]", "title:asc");

  const payload = await strapiJson<StrapiListResponse<ManagedStrapiPage>>(url);
  return (payload.data ?? []).flatMap((entity) => {
    const page = normalizeManagedPage(entity);
    return page ? [page] : [];
  });
}

export async function updateManagedSiteSettings(
  input: ManagedSiteSettingsInput,
  status: StrapiPublicationStatus = "draft",
) {
  const baseUrl = requireConfig();
  const url = new URL("/api/site-setting", baseUrl);
  url.searchParams.set("status", status);
  const payload = await strapiJson<StrapiSingleResponse<ManagedSiteSettings>>(url, {
    method: "PUT",
    body: JSON.stringify(siteSettingsPayload(input)),
  });
  const settings = payload.data ? normalizeSettings(payload.data) : null;

  if (!settings) {
    throw new Error("Strapi did not return the updated site settings.");
  }

  return settings;
}

export async function unpublishManagedSiteSettings() {
  const baseUrl = requireConfig();
  const url = new URL("/api/site-setting", baseUrl);
  url.searchParams.set("status", "published");
  await strapiJson<null>(url, { method: "DELETE" });
  const settings = await getManagedSiteSettings();

  if (!settings) {
    throw new Error("Site settings were unpublished, but the draft could not be reloaded.");
  }

  return settings;
}
