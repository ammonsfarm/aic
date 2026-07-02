import "server-only";

import type { StrapiMedia, StrapiPageSection } from "@/lib/strapi";

export type ManagedStrapiPage = {
  id?: number;
  documentId: string;
  pageKey: string;
  slug: string;
  title: string;
  active: boolean;
  showInNavigation: boolean;
  navigationLabel: string;
  navigationOrder: number | null;
  heroTitle: string;
  heroBody: string;
  seoTitle: string;
  seoDescription: string;
  publishedAt: string;
  updatedAt: string;
  createdAt: string;
  sections: StrapiPageSection[];
};

export type ManagedStrapiPageInput = {
  pageKey: string;
  slug: string;
  title: string;
  active: boolean;
  showInNavigation: boolean;
  navigationLabel: string;
  navigationOrder: number | null;
  heroTitle: string;
  heroBody: string;
  seoTitle: string;
  seoDescription: string;
  sections: Array<Record<string, unknown>>;
};

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
    throw new Error("Strapi management is not configured. Set STRAPI_URL and STRAPI_API_TOKEN_TEMP_WRITE or STRAPI_API_TOKEN.");
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

function normalizeMedia(media: unknown): StrapiMedia | null {
  if (!media || typeof media !== "object") {
    return null;
  }

  const entity = media as Record<string, unknown>;
  const source = asRecord(entity.attributes ?? entity);
  const rawUrl = getString(source.url);

  if (!rawUrl) {
    return null;
  }

  const baseUrl = strapiBaseUrl();
  const url = rawUrl.startsWith("http") || !baseUrl ? rawUrl : new URL(rawUrl, baseUrl).toString();

  return {
    id: typeof entity.id === "number" ? entity.id : undefined,
    url,
    alternativeText: getString(source.alternativeText),
    name: getString(source.name),
  };
}

function normalizeSection(section: unknown): StrapiPageSection | null {
  const source = asRecord(section);
  const component = getString(source.__component);
  const imageSide = getString(source.imageSide);

  if (!component) {
    return null;
  }

  return {
    id: typeof source.id === "number" ? source.id : undefined,
    component,
    eyebrow: getString(source.eyebrow),
    heading: getString(source.heading),
    body: getString(source.body),
    buttonLabel: getString(source.buttonLabel),
    buttonUrl: getString(source.buttonUrl),
    imageSide: imageSide === "none" || imageSide === "left" || imageSide === "right" ? imageSide : "",
    image: normalizeMedia(source.image),
  };
}

function normalizePage(entity: StrapiEntity<ManagedStrapiPage>): ManagedStrapiPage | null {
  const source = asRecord(entity.attributes ?? entity);
  const documentId = getString(entity.documentId ?? source.documentId);
  const pageKey = getString(source.pageKey);
  const slug = getString(source.slug);
  const title = getString(source.title);

  if (!documentId || (!pageKey && !slug && !title)) {
    return null;
  }

  const rawSections = Array.isArray(source.sections) ? source.sections : [];

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
    heroTitle: getString(source.heroTitle),
    heroBody: getString(source.heroBody),
    seoTitle: getString(source.seoTitle),
    seoDescription: getString(source.seoDescription),
    publishedAt: getString(source.publishedAt),
    updatedAt: getString(source.updatedAt),
    createdAt: getString(source.createdAt),
    sections: rawSections.flatMap((section) => {
      const normalized = normalizeSection(section);
      return normalized ? [normalized] : [];
    }),
  };
}

async function strapiJson<T>(url: URL | string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
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

function pagePayload(input: ManagedStrapiPageInput) {
  return {
    data: {
      pageKey: input.pageKey,
      slug: input.slug,
      title: input.title,
      active: input.active,
      showInNavigation: input.showInNavigation,
      navigationLabel: input.navigationLabel,
      navigationOrder: input.navigationOrder,
      heroTitle: input.heroTitle,
      heroBody: input.heroBody,
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
      sections: input.sections,
    },
  };
}

export async function listManagedStrapiPages() {
  const baseUrl = requireConfig();
  const url = new URL("/api/pages", baseUrl);
  url.searchParams.set("status", "draft");
  url.searchParams.set("pagination[pageSize]", "100");
  url.searchParams.set("sort[0]", "navigationOrder:asc");
  url.searchParams.set("sort[1]", "title:asc");
  url.searchParams.set("populate[sections][populate]", "*");

  const payload = await strapiJson<StrapiListResponse<ManagedStrapiPage>>(url);
  return (payload.data ?? []).flatMap((entity) => {
    const page = normalizePage(entity);
    return page ? [page] : [];
  });
}

export async function getManagedStrapiPage(documentId: string) {
  const baseUrl = requireConfig();
  const url = new URL(`/api/pages/${documentId}`, baseUrl);
  url.searchParams.set("status", "draft");
  url.searchParams.set("populate[sections][populate]", "*");

  const payload = await strapiJson<StrapiSingleResponse<ManagedStrapiPage>>(url);
  return payload.data ? normalizePage(payload.data) : null;
}

export async function createManagedStrapiPage(input: ManagedStrapiPageInput) {
  const baseUrl = requireConfig();
  const url = new URL("/api/pages", baseUrl);
  const payload = await strapiJson<StrapiSingleResponse<ManagedStrapiPage>>(url, {
    method: "POST",
    body: JSON.stringify(pagePayload(input)),
  });
  const page = payload.data ? normalizePage(payload.data) : null;

  if (!page) {
    throw new Error("Strapi did not return the created page.");
  }

  return page;
}

export async function updateManagedStrapiPage(documentId: string, input: ManagedStrapiPageInput) {
  const baseUrl = requireConfig();
  const url = new URL(`/api/pages/${documentId}`, baseUrl);
  const payload = await strapiJson<StrapiSingleResponse<ManagedStrapiPage>>(url, {
    method: "PUT",
    body: JSON.stringify(pagePayload(input)),
  });
  const page = payload.data ? normalizePage(payload.data) : null;

  if (!page) {
    throw new Error("Strapi did not return the updated page.");
  }

  return page;
}
