import { timingSafeEqual } from "crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { STRAPI_PAGES_CACHE_TAG, strapiPageCacheTag } from "@/lib/strapi";
import {
  STRAPI_PUBLIC_MEDIA_CACHE_TAG,
  STRAPI_STRUCTURED_CACHE_TAG,
  strapiPublicMediaCacheTag,
  strapiStructuredCacheTag,
} from "@/lib/strapi-cache-tags";
import { STRAPI_SITE_SETTINGS_CACHE_TAG } from "@/lib/strapi-site-settings";
import { isPublicStrapiChange, strapiWebhookEvent } from "@/lib/strapi-webhook";
import { STRUCTURED_COLLECTION_KEYS } from "@/lib/structured-content-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE_PATH_BY_KEY: Record<string, string> = {
  about: "/about-pastor-wood",
  "about-pastor-wood": "/about-pastor-wood",
  "abiding-in-christ": "/abiding-in-christ",
  "bible-study": "/bible-study",
  "board-members": "/board-members",
  contact: "/contact",
  donate: "/donate",
  "donor-dashboard": "/donor-dashboard",
  endorsements: "/endorsements",
  home: "/",
  privacy: "/privacy",
  "privacy-terms-conditions": "/privacy-terms-conditions",
  "written-resources": "/written-resources",
};

const KNOWN_STRAPI_PAGE_PATHS = [...new Set(Object.values(PAGE_PATH_BY_KEY))];
const STRUCTURED_PUBLIC_PATHS = [
  "/bible-study",
  "/board-members",
  "/endorsements",
  "/radio",
  "/written-resources",
  "/writings",
  "/sitemap.xml",
];

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIdentifier(value: unknown) {
  return textValue(value).toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function safeSecretEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function requestSecret(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);

  return (
    bearerMatch?.[1]?.trim() ??
    request.headers.get("x-strapi-revalidate-secret")?.trim() ??
    request.headers.get("x-revalidate-secret")?.trim() ??
    ""
  );
}

async function readPayload(request: NextRequest) {
  try {
    return (await request.json()) as unknown;
  } catch {
    return {};
  }
}

function collectIdentifiers(payload: unknown) {
  const records = new Set<Record<string, unknown>>();
  const root = asRecord(payload);

  if (root) {
    records.add(root);
    for (const key of ["entry", "data", "result"]) {
      const child = asRecord(root[key]);
      if (child) {
        records.add(child);
      }
    }
  }

  const pageKeys = new Set<string>();
  const slugs = new Set<string>();
  const documentIds = new Set<string>();

  for (const record of records) {
    const pageKey = normalizeIdentifier(record.pageKey);
    const slug = normalizeIdentifier(record.slug);
    const documentId = textValue(record.documentId);

    if (pageKey) {
      pageKeys.add(pageKey);
    }

    if (slug) {
      slugs.add(slug);
    }
    if (documentId) {
      documentIds.add(documentId);
    }
  }

  return { pageKeys, slugs, documentIds };
}

function publicPathForIdentifier(identifier: string) {
  if (PAGE_PATH_BY_KEY[identifier]) {
    return PAGE_PATH_BY_KEY[identifier];
  }

  return identifier === "home" ? "/" : `/${identifier.replace(/^\/+/, "")}`;
}

function pathsToRevalidate(pageKeys: Set<string>, slugs: Set<string>) {
  const paths = new Set<string>();

  for (const pageKey of pageKeys) {
    paths.add(publicPathForIdentifier(pageKey));
  }

  for (const slug of slugs) {
    paths.add(publicPathForIdentifier(slug));
  }

  if (paths.size === 0) {
    for (const path of KNOWN_STRAPI_PAGE_PATHS) {
      paths.add(path);
    }
  }

  return paths;
}

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.STRAPI_REVALIDATE_SECRET?.trim() ?? "";
  if (!configuredSecret) {
    return NextResponse.json({ error: "Strapi revalidation is not configured." }, { status: 500 });
  }

  const providedSecret = requestSecret(request);
  if (!providedSecret || !safeSecretEquals(providedSecret, configuredSecret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const payload = await readPayload(request);
  if (!isPublicStrapiChange(payload)) {
    return NextResponse.json({
      revalidated: false,
      event: strapiWebhookEvent(payload) || "unknown",
      reason: "Only public content create, update, publish, unpublish, and delete events invalidate the public cache.",
    });
  }

  const { pageKeys, slugs, documentIds } = collectIdentifiers(payload);
  const tags = new Set([
    STRAPI_PAGES_CACHE_TAG,
    STRAPI_SITE_SETTINGS_CACHE_TAG,
    STRAPI_STRUCTURED_CACHE_TAG,
    STRAPI_PUBLIC_MEDIA_CACHE_TAG,
    ...STRUCTURED_COLLECTION_KEYS.map(strapiStructuredCacheTag),
  ]);
  const paths = pathsToRevalidate(pageKeys, slugs);
  for (const path of STRUCTURED_PUBLIC_PATHS) {
    paths.add(path);
  }

  for (const pageKey of pageKeys) {
    tags.add(strapiPageCacheTag(pageKey));
  }

  for (const slug of slugs) {
    tags.add(strapiPageCacheTag(slug));
  }

  for (const documentId of documentIds) {
    tags.add(strapiPublicMediaCacheTag(documentId));
  }

  for (const tag of tags) {
    revalidateTag(tag, { expire: 0 });
  }

  for (const path of paths) {
    revalidatePath(path, "page");
  }
  revalidatePath("/writings/[slug]", "page");
  revalidatePath("/radio/[[...slug]]", "page");

  return NextResponse.json({
    revalidated: true,
    tags: [...tags],
    paths: [...paths],
  });
}
