import "server-only";

import type { CurrentAppUser } from "@/lib/rbac";
import { listManagedStrapiPages, type StrapiPublicationStatus } from "@/lib/strapi-management";
import { fetchWithTimeout } from "@/lib/strapi-request";

type StrapiEntity<T> = {
  id?: number;
  documentId?: string;
  attributes?: Partial<T>;
} & Partial<T>;

type StrapiSingleResponse<T> = {
  data?: StrapiEntity<T>;
};

export class StrapiSiteSettingsRequestError extends Error {
  constructor(public readonly status: number, detail: string) {
    super(`Strapi request failed with ${status}: ${detail}`);
    this.name = "StrapiSiteSettingsRequestError";
  }
}

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

export type ManagedSiteSettingsMedia = {
  id?: number;
  documentId: string;
  name: string;
  alternativeText: string;
  previewUrl: string;
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
  headerLogo: ManagedSiteSettingsMedia | null;
  subscriptionEnabled: boolean;
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
  headerLogoId: number | null;
  subscriptionEnabled: boolean;
};

export type ManagedSiteSettingsRevision = {
  documentId: string;
  revisionNumber: number;
  action: string;
  actorEmail: string;
  actorName: string;
  note: string;
  snapshot: Record<string, unknown>;
  createdAt: string;
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

function mediaPreviewUrl(value: unknown) {
  const entity = asRecord(value);
  const source = asRecord(entity.attributes ?? entity);
  const rawUrl = getString(source.url);
  if (!rawUrl || rawUrl.startsWith("//")) {
    return "";
  }

  try {
    const absolute = /^https?:\/\//i.test(rawUrl);
    const parsed = new URL(rawUrl, "https://strapi-preview.invalid");
    const baseUrl = strapiBaseUrl();
    const sameStrapi = !absolute || (baseUrl && parsed.origin === new URL(baseUrl).origin);
    if (!sameStrapi || !parsed.pathname.startsWith("/uploads/")) {
      return "";
    }
    const encodedPath = parsed.pathname
      .slice("/uploads/".length)
      .split("/")
      .filter(Boolean)
      .map((part) => encodeURIComponent(decodeURIComponent(part)))
      .join("/");
    return encodedPath ? `/api/content/strapi-media/${encodedPath}` : "";
  } catch {
    return "";
  }
}

function normalizeMedia(value: unknown): ManagedSiteSettingsMedia | null {
  const entity = asRecord(value);
  const source = asRecord(entity.attributes ?? entity);
  const id = getNumber(entity.id ?? source.id);
  const documentId = getString(entity.documentId ?? source.documentId);
  const previewUrl = mediaPreviewUrl(value);
  if (!id && !documentId && !previewUrl) {
    return null;
  }
  return {
    id: id ?? undefined,
    documentId,
    name: getString(source.name),
    alternativeText: getString(source.alternativeText),
    previewUrl,
  };
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
    throw new StrapiSiteSettingsRequestError(response.status, text.slice(0, 500));
  }

  return (text ? JSON.parse(text) : null) as T;
}

function normalizePageEntity(page: unknown) {
  const entity = asRecord(page);
  const source = asRecord(entity.attributes ?? entity);
  const id = typeof entity.id === "number" ? String(entity.id) : "";
  const documentId = getString(entity.documentId ?? source.documentId);

  return {
    relationValue: documentId || id,
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
    headerLogo: normalizeMedia(source.headerLogo),
    subscriptionEnabled: getBoolean(source.subscriptionEnabled, true),
    updatedAt: getString(source.updatedAt),
    publishedAt: getString(source.publishedAt),
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
      headerLogo: input.headerLogoId,
      subscriptionEnabled: input.subscriptionEnabled,
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
    url.searchParams.set("populate[headerLogo]", "*");
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
  return listManagedStrapiPages();
}

function editorialActor(user: CurrentAppUser) {
  return {
    id: user.clerkUserId,
    email: user.email,
    name: user.name,
  };
}

async function editorialSettingsRequest<T>(
  path: string,
  method: "POST" | "PUT" | "GET",
  body?: Record<string, unknown>,
) {
  return strapiJson<T>(new URL(path, requireConfig()), {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

export async function createManagedSiteSettingsWithWorkflow(
  input: ManagedSiteSettingsInput,
  user: CurrentAppUser,
  note = "",
) {
  const payload = await editorialSettingsRequest<StrapiSingleResponse<ManagedSiteSettings>>(
    "/api/editorial/site-setting",
    "POST",
    { data: siteSettingsPayload(input).data, actor: editorialActor(user), note },
  );
  const settings = payload.data ? normalizeSettings(payload.data) : null;
  if (!settings) {
    throw new Error("Strapi did not return the initialized site settings.");
  }
  return settings;
}

export async function updateManagedSiteSettingsWithWorkflow(
  documentId: string,
  input: ManagedSiteSettingsInput,
  user: CurrentAppUser,
  expectedUpdatedAt: string,
  note = "",
) {
  const payload = await editorialSettingsRequest<StrapiSingleResponse<ManagedSiteSettings>>(
    `/api/editorial/site-setting/${encodeURIComponent(documentId)}`,
    "PUT",
    { data: siteSettingsPayload(input).data, actor: editorialActor(user), expectedUpdatedAt, note },
  );
  const settings = payload.data ? normalizeSettings(payload.data) : null;
  if (!settings) {
    throw new Error("Strapi did not return the updated site settings.");
  }
  return settings;
}

export async function saveAndTransitionManagedSiteSettings(
  documentId: string,
  action: "publish" | "unpublish",
  input: ManagedSiteSettingsInput,
  user: CurrentAppUser,
  expectedUpdatedAt: string,
  note = "",
) {
  return editorialSettingsRequest<StrapiSingleResponse<ManagedSiteSettings>>(
    `/api/editorial/site-setting/${encodeURIComponent(documentId)}/${action}`,
    "POST",
    {
      data: siteSettingsPayload(input).data,
      actor: editorialActor(user),
      expectedUpdatedAt,
      note,
    },
  );
}

export async function rollbackManagedSiteSettings(
  documentId: string,
  revisionDocumentId: string,
  user: CurrentAppUser,
  expectedUpdatedAt: string,
  note = "",
) {
  return editorialSettingsRequest<StrapiSingleResponse<ManagedSiteSettings>>(
    `/api/editorial/site-setting/${encodeURIComponent(documentId)}/rollback`,
    "POST",
    { actor: editorialActor(user), note, revisionDocumentId, expectedUpdatedAt },
  );
}

export async function listManagedSiteSettingsRevisions(documentId: string) {
  const revisions: ManagedSiteSettingsRevision[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const payload = await editorialSettingsRequest<{ data?: Array<StrapiEntity<Record<string, unknown>>> }>(
      `/api/editorial/site-setting/${encodeURIComponent(documentId)}/revisions?page=${page}`,
      "GET",
    );
    const batch = payload.data ?? [];
    revisions.push(...batch.flatMap((entity) => {
      const source = asRecord(entity.attributes ?? entity);
      const revisionDocumentId = getString(entity.documentId ?? source.documentId);
      if (!revisionDocumentId) {
        return [];
      }
      return [{
        documentId: revisionDocumentId,
        revisionNumber: getNumber(source.revisionNumber) ?? 0,
        action: getString(source.action),
        actorEmail: getString(source.actorEmail),
        actorName: getString(source.actorName),
        note: getString(source.note),
        snapshot: asRecord(source.snapshot),
        createdAt: getString(source.createdAt),
      }];
    }));
    if (batch.length < 100) {
      return revisions;
    }
  }
  throw new Error("Site settings revision history exceeds the supported 10,000-item safety bound.");
}
