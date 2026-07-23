#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertPublicCacheInvalidationSecret,
  flushPendingPublicCacheInvalidation,
  markPublicCacheInvalidationPending,
  SCHEDULED_PUBLICATION_INVALIDATION_MARKER,
} from "./public_cache_invalidation.mjs";

const CANONICAL_AIC_ENV = "/mnt/storage/aic/.env";

const ENTITY_COLLECTIONS = [
  { entityType: "page", collection: "pages" },
  { entityType: "post", collection: "posts" },
  { entityType: "episode", collection: "episodes" },
];

const IDEMPOTENT_SKIP_CODES = new Set([
  "EDITORIAL_NOT_FOUND",
  "EDITORIAL_SCHEDULE_INELIGIBLE",
  "EDITORIAL_SCHEDULE_NOT_DUE",
  "EDITORIAL_VERSION_CONFLICT",
]);

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed[0] === trimmed.at(-1) && ["\"", "'"].includes(trimmed[0])) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export async function loadEnvFile(path) {
  const contents = await readFile(path, "utf8");
  const values = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (Object.hasOwn(values, key)) throw new Error(`Canonical environment contains duplicate ${key}.`);
    const value = unquote(line.slice(separator + 1));
    values[key] = value;
  }
  return values;
}

export function dueCollectionPath(collection, now, pageSize) {
  const query = new URLSearchParams();
  query.set("status", "draft");
  query.set("filters[scheduledFor][$notNull]", "true");
  query.set("filters[scheduledFor][$lte]", now);
  query.set("filters[archivedAt][$null]", "true");
  query.set("sort", "scheduledFor:asc");
  query.set("pagination[page]", "1");
  query.set("pagination[pageSize]", String(pageSize));
  return `/api/${collection}?${query.toString()}`;
}

function boundedLimit(value) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("--limit must be a whole number between 1 and 100.");
  }
  return limit;
}

async function jsonRequest(fetchImpl, url, token, init = {}) {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const error = new Error(`Strapi scheduled-publication request failed with HTTP ${response.status}.`);
    error.status = response.status;
    const code = payload?.error?.details?.code;
    error.classification = typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code) ? code : "UNCLASSIFIED_HTTP_ERROR";
    throw error;
  }
  return payload;
}

function safeFailureContext(entityType, documentId, error) {
  return {
    worker: "scheduled-publication",
    event: "publication-failed",
    entityType,
    documentId: /^[A-Za-z0-9_-]{1,120}$/.test(documentId) ? documentId : "invalid-document-id",
    status: Number.isInteger(error?.status) ? error.status : null,
    classification: typeof error?.classification === "string" && /^[A-Z0-9_]{1,64}$/.test(error.classification)
      ? error.classification
      : "REQUEST_FAILURE",
  };
}

export async function runScheduledPublications({
  baseUrl,
  token,
  actorEmail,
  limit = 25,
  now = new Date().toISOString(),
  fetchImpl = fetch,
  beforePublish = async () => undefined,
}) {
  const safeLimit = boundedLimit(limit);
  const origin = baseUrl.replace(/\/+$/, "");
  if (!/^https?:\/\//.test(origin) || !token || !actorEmail) {
    throw new Error("Strapi URL, scoped management token, and scheduled-publication actor are required.");
  }

  const summary = { considered: 0, published: 0, skipped: 0, failed: 0 };
  for (const { entityType, collection } of ENTITY_COLLECTIONS) {
    const remaining = safeLimit - summary.considered;
    if (remaining <= 0) break;
    const payload = await jsonRequest(
      fetchImpl,
      `${origin}${dueCollectionPath(collection, now, Math.min(remaining, 50))}`,
      token,
    );
    const entries = Array.isArray(payload?.data) ? payload.data : [];
    for (const entry of entries.slice(0, remaining)) {
      const documentId = typeof entry?.documentId === "string" ? entry.documentId : "";
      const expectedUpdatedAt = typeof entry?.updatedAt === "string" ? entry.updatedAt : "";
      if (!/^[A-Za-z0-9_-]{1,120}$/.test(documentId) || !expectedUpdatedAt) {
        summary.skipped += 1;
        summary.considered += 1;
        continue;
      }
      summary.considered += 1;
      try {
        await beforePublish({ entityType, documentId });
        await jsonRequest(
          fetchImpl,
          `${origin}/api/editorial/${entityType}/${encodeURIComponent(documentId)}/publish-scheduled`,
          token,
          {
            method: "POST",
            body: JSON.stringify({
              expectedUpdatedAt,
              actor: {
                id: "system:scheduled-publication",
                email: actorEmail,
                name: "Scheduled publication worker",
              },
              note: "Published automatically at the scheduled time.",
            }),
          },
        );
        summary.published += 1;
      } catch (error) {
        if (IDEMPOTENT_SKIP_CODES.has(error?.classification)) {
          summary.skipped += 1;
        } else {
          summary.failed += 1;
          console.error(JSON.stringify(safeFailureContext(entityType, documentId, error)));
        }
      }
    }
  }
  return summary;
}

export async function runScheduledPublicationCycle({
  revalidationSecret,
  invalidationMarkerPath = SCHEDULED_PUBLICATION_INVALIDATION_MARKER,
  fetchImpl = fetch,
  ...publicationOptions
}) {
  assertPublicCacheInvalidationSecret(revalidationSecret);
  await flushPendingPublicCacheInvalidation({
    markerPath: invalidationMarkerPath,
    secret: revalidationSecret,
    fetchImpl,
  });

  try {
    return await runScheduledPublications({
      ...publicationOptions,
      fetchImpl,
      beforePublish: async () => {
        await markPublicCacheInvalidationPending(invalidationMarkerPath, "scheduled-publication");
      },
    });
  } finally {
    await flushPendingPublicCacheInvalidation({
      markerPath: invalidationMarkerPath,
      secret: revalidationSecret,
      fetchImpl,
    });
  }
}

function parseArguments(argv) {
  const options = { envFile: "/mnt/storage/aic/.env", limit: 25 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--env-file" && argv[index + 1]) options.envFile = argv[++index];
    else if (argv[index] === "--limit" && argv[index + 1]) options.limit = boundedLimit(argv[++index]);
    else if (argv[index] === "--help") {
      return { ...options, help: true };
    } else {
      throw new Error(`Unsupported argument: ${argv[index]}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: publish_scheduled_strapi_content.mjs [--env-file PATH] [--limit 1..100]");
    return;
  }
  if (resolve(options.envFile) !== CANONICAL_AIC_ENV) {
    throw new Error(`Scheduled publication requires the canonical environment at ${CANONICAL_AIC_ENV}.`);
  }
  const canonicalValues = await loadEnvFile(options.envFile);
  const summary = await runScheduledPublicationCycle({
    baseUrl: canonicalValues.STRAPI_MANAGEMENT_URL?.trim() || canonicalValues.STRAPI_URL?.trim() || "",
    token:
      canonicalValues.STRAPI_API_TOKEN_TEMP_WRITE?.trim() ||
      canonicalValues.STRAPI_MANAGEMENT_TOKEN?.trim() ||
      canonicalValues.STRAPI_API_TOKEN?.trim() ||
      "",
    actorEmail: canonicalValues.SCHEDULED_PUBLICATION_ACTOR_EMAIL?.trim() || "scheduled-publication@pastorwood.local",
    revalidationSecret: canonicalValues.STRAPI_REVALIDATE_SECRET?.trim() || "",
    limit: options.limit,
  });
  console.log(JSON.stringify({ worker: "scheduled-publication", ...summary }));
  if (summary.failed > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Scheduled publication worker failed.");
    process.exitCode = 1;
  });
}
