import "server-only";

import { queryRows } from "@/lib/db";

export type PublicProjectionEntityType =
  | "page"
  | "site-setting"
  | "post"
  | "episode"
  | "person"
  | "endorsement"
  | "media-asset"
  | "redirect";

export type ProjectionLookupResult<T extends Record<string, unknown>> =
  | { status: "found"; item: T }
  | { status: "not-found" }
  | { status: "absent" };

export type ProjectionPage<T extends Record<string, unknown>> = {
  items: T[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  hasState: boolean;
};

type ProjectionRow = {
  entity_type?: PublicProjectionEntityType;
  document_id: string;
  is_published: boolean;
  payload: Record<string, unknown> | null;
};

type CountRow = { total: string };

type ProjectedMediaRow = {
  media_document_id: string;
  media_url: string;
  mime_type: string;
  size_bytes: string | number | null;
};

function boundedPage(page: number, pageSize: number) {
  const normalizedPage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const normalizedPageSize = Number.isFinite(pageSize) ? Math.min(100, Math.max(1, Math.floor(pageSize))) : 24;
  return {
    page: normalizedPage,
    pageSize: normalizedPageSize,
    offset: (normalizedPage - 1) * normalizedPageSize,
  };
}

function safeIdentifier(value: string, maximum = 512) {
  return Array.from(value.trim()).slice(0, maximum).join("");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(item)))]
    : [];
}

async function projectionTypeHasState(entityType: PublicProjectionEntityType) {
  const rows = await queryRows<{ has_state: boolean }>(
    `select exists (
       select 1
       from public.pastorwood_public_projection
       where entity_type = $1
     ) as has_state`,
    [entityType],
  );
  return rows[0]?.has_state === true;
}

async function enrichProjectedRelations<T extends Record<string, unknown>>(
  entityType: PublicProjectionEntityType,
  items: T[],
): Promise<T[]> {
  const peopleIds = new Set<string>();
  const pageIds = new Set<string>();
  for (const item of items) {
    if (typeof item.authorDocumentId === "string" && item.authorDocumentId) peopleIds.add(item.authorDocumentId);
    for (const id of stringArray(item.guestDocumentIds)) peopleIds.add(id);
    if (typeof item.personDocumentId === "string" && item.personDocumentId) peopleIds.add(item.personDocumentId);
    if (entityType === "site-setting") {
      for (const key of ["topNavigation", "footerNavigation", "utilityNavigation"] as const) {
        for (const navigationItem of Array.isArray(item[key]) ? item[key] : []) {
          const source = record(navigationItem);
          if (typeof source?.pageDocumentId === "string" && source.pageDocumentId) pageIds.add(source.pageDocumentId);
        }
      }
    }
  }
  if (!peopleIds.size && !pageIds.size) return items;

  const clauses: string[] = [];
  const values: unknown[] = [];
  if (peopleIds.size) {
    values.push([...peopleIds]);
    clauses.push(`(entity_type = 'person' and document_id = any($${values.length}::text[]))`);
  }
  if (pageIds.size) {
    values.push([...pageIds]);
    clauses.push(`(entity_type = 'page' and document_id = any($${values.length}::text[]))`);
  }
  const relations = await queryRows<ProjectionRow>(
    `select entity_type, document_id, is_published, payload
     from public.pastorwood_public_projection
     where is_published = true and (${clauses.join(" or ")})`,
    values,
  );
  const projectedPeople = new Map(
    relations
      .filter((row) => row.entity_type === "person" && row.is_published && record(row.payload)?.active !== false)
      .map((row) => [row.document_id, record(row.payload)!]),
  );
  const projectedPages = new Map(
    relations
      .filter((row) => row.entity_type === "page" && row.is_published && record(row.payload)?.active !== false)
      .map((row) => [row.document_id, record(row.payload)!]),
  );

  return items.map((item) => {
    const enriched: Record<string, unknown> = { ...item };
    if (typeof item.authorDocumentId === "string") {
      const person = projectedPeople.get(item.authorDocumentId);
      enriched.author = person ? {
        documentId: item.authorDocumentId,
        name: person.name,
        title: person.title,
        organization: person.organization,
      } : null;
    }
    if (Array.isArray(item.guestDocumentIds)) {
      enriched.guests = stringArray(item.guestDocumentIds).flatMap((id) => {
        const person = projectedPeople.get(id);
        return person ? [{ documentId: id, name: person.name, title: person.title, organization: person.organization }] : [];
      });
    }
    if (typeof item.personDocumentId === "string") {
      const person = projectedPeople.get(item.personDocumentId);
      enriched.person = person ? {
        documentId: item.personDocumentId,
        name: person.name,
        title: person.title,
        organization: person.organization,
      } : null;
    }
    if (entityType === "site-setting") {
      for (const key of ["topNavigation", "footerNavigation", "utilityNavigation"] as const) {
        enriched[key] = (Array.isArray(item[key]) ? item[key] : []).flatMap((navigationItem) => {
          const source = record(navigationItem);
          if (!source) return [];
          const pageId = typeof source.pageDocumentId === "string" ? source.pageDocumentId : "";
          if (!pageId) return [source];
          const page = projectedPages.get(pageId);
          return page ? [{
            ...source,
            page: {
              documentId: pageId,
              pageKey: page.pageKey,
              slug: page.slug,
              title: page.title,
            },
          }] : [];
        });
      }
    }
    return enriched as T;
  });
}

export async function getProjectedContentByIdentity<T extends Record<string, unknown>>(
  entityType: PublicProjectionEntityType,
  identityType: "slug" | "track-id" | "page-key" | "singleton" | "path",
  identityValue: string,
): Promise<ProjectionLookupResult<T>> {
  const normalized = safeIdentifier(identityValue, identityType === "track-id" ? 100 : 512);
  if (!normalized) return { status: "not-found" };
  const rows = await queryRows<ProjectionRow & { is_current: boolean }>(
    `select p.document_id, p.is_published, p.payload, i.is_current
     from public.pastorwood_public_projection_identities i
     join public.pastorwood_public_projection p
       on p.entity_type = i.entity_type and p.document_id = i.document_id
     where i.entity_type = $1 and i.identity_type = $2 and i.identity_value = $3
     limit 1`,
    [entityType, identityType, identityType === "track-id" ? normalized : normalized.toLowerCase()],
  );
  const row = rows[0];
  if (!row) {
    return await projectionTypeHasState(entityType) ? { status: "not-found" } : { status: "absent" };
  }
  const payload = record(row.payload);
  if (!row.is_current || !row.is_published || !payload) return { status: "not-found" };
  const [item] = await enrichProjectedRelations(entityType, [payload as T]);
  return { status: "found", item };
}

export async function listProjectedIdentityStates(
  entityType: PublicProjectionEntityType,
  identityType: "slug" | "track-id" | "page-key" | "singleton" | "path",
) {
  const rows = await queryRows<{ identity_value: string; document_id: string; is_current: boolean; is_published: boolean }>(
    `select i.identity_value, i.document_id, i.is_current, p.is_published
     from public.pastorwood_public_projection_identities i
     join public.pastorwood_public_projection p
       on p.entity_type = i.entity_type and p.document_id = i.document_id
     where i.entity_type = $1 and i.identity_type = $2`,
    [entityType, identityType],
  );
  return new Map(rows.map((row) => [row.identity_value, row.is_current && row.is_published]));
}

export async function listProjectedContentPage<T extends Record<string, unknown>>(
  entityType: PublicProjectionEntityType,
  requestedPage: number,
  requestedPageSize: number,
  options: {
    contentType?: string;
    query?: string;
    year?: number | null;
    activeOnly?: boolean;
    boardOnly?: boolean;
    publicMediaOnly?: boolean;
  } = {},
): Promise<ProjectionPage<T>> {
  const { page, pageSize, offset } = boundedPage(requestedPage, requestedPageSize);
  const where = ["entity_type = $1", "is_published = true", "payload is not null"];
  const values: unknown[] = [entityType];
  if (options.contentType) {
    values.push(options.contentType);
    where.push(`payload->>'contentType' = $${values.length}`);
  }
  if (options.activeOnly) where.push(`payload->>'active' = 'true'`);
  if (options.boardOnly) where.push(`payload->>'showOnBoard' = 'true'`);
  if (options.publicMediaOnly) where.push(`payload->>'visibility' = 'public'`);
  const query = Array.from((options.query || "").trim()).slice(0, 80).join("");
  if (query && entityType === "episode") {
    values.push(`%${query}%`);
    where.push(`concat_ws(' ', payload->>'title', payload->>'summary', payload->>'description', payload->>'trackId') ilike $${values.length}`);
  }
  if (Number.isSafeInteger(options.year) && Number(options.year) >= 1900 && Number(options.year) <= 2100 && entityType === "episode") {
    values.push(String(options.year));
    where.push(`left(payload->>'programDate', 4) = $${values.length}`);
  }
  const whereSql = where.join(" and ");
  const orderSql = entityType === "post"
    ? "nullif(payload->>'publishDate', '')::timestamptz desc nulls last, payload->>'title' asc"
    : entityType === "episode"
      ? "nullif(payload->>'programDate', '')::date desc nulls last, payload->>'title' asc"
      : entityType === "person" || entityType === "endorsement"
        ? "coalesce((payload->>'sortOrder')::integer, 0) asc, projected_at asc"
        : "projected_at desc";
  const listValues = [...values, pageSize, offset];
  const [counts, rows] = await Promise.all([
    queryRows<CountRow>(
      `select count(*)::text as total from public.pastorwood_public_projection where ${whereSql}`,
      values,
    ),
    queryRows<ProjectionRow>(
      `select document_id, is_published, payload
       from public.pastorwood_public_projection
       where ${whereSql}
       order by ${orderSql}
       limit $${values.length + 1} offset $${values.length + 2}`,
      listValues,
    ),
  ]);
  const total = Number(counts[0]?.total || 0);
  const hasState = total > 0 || await projectionTypeHasState(entityType);
  const payloads = rows.flatMap((row) => {
    const payload = record(row.payload);
    return row.is_published && payload ? [payload as T] : [];
  });
  return {
    items: await enrichProjectedRelations(entityType, payloads),
    page,
    pageSize,
    pageCount: total > 0 ? Math.ceil(total / pageSize) : 0,
    total,
    hasState,
  };
}

export async function listAllProjectedContent<T extends Record<string, unknown>>(
  entityType: PublicProjectionEntityType,
): Promise<{ items: T[]; hasState: boolean }> {
  const items: T[] = [];
  let hasState = false;
  for (let page = 1; page <= 10_000; page += 1) {
    const result = await listProjectedContentPage<T>(entityType, page, 100);
    hasState = result.hasState;
    items.push(...result.items);
    if (!result.pageCount || page >= result.pageCount) break;
  }
  return { items, hasState };
}

export async function getProjectedPublicMedia(mediaDocumentId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(mediaDocumentId)) return null;
  const rows = await queryRows<ProjectedMediaRow>(
    `select m.media_document_id, m.media_url, m.mime_type, m.size_bytes
     from public.pastorwood_public_projection_media m
     join public.pastorwood_public_projection p
       on p.entity_type = m.entity_type and p.document_id = m.document_id
     where m.media_document_id = $1 and p.is_published = true and p.payload is not null
     order by m.projected_at desc
     limit 1`,
    [mediaDocumentId],
  );
  const row = rows[0];
  if (!row) return null;
  const size = row.size_bytes === null ? null : Number(row.size_bytes);
  return {
    documentId: row.media_document_id,
    url: row.media_url,
    mime: row.mime_type || "application/octet-stream",
    size: size !== null && Number.isSafeInteger(size) && size >= 0 ? size : null,
  };
}
