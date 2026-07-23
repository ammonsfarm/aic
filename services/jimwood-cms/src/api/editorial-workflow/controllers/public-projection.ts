type DocumentRecord = Record<string, unknown>;

export type PublicProjectionEntityType =
  | 'page'
  | 'site-setting'
  | 'post'
  | 'episode'
  | 'person'
  | 'endorsement'
  | 'media-asset'
  | 'redirect';

export type ProjectionTransaction = {
  raw(sql: string, bindings?: unknown[]): Promise<unknown>;
};

type ProjectedMedia = {
  documentId: string;
  url: string;
  name: string;
  mime: string;
  size: number | null;
  alternativeText: string;
  caption: string;
};

const publicIdentityPattern = /^[A-Za-z0-9_-]{1,128}$/;
const operationalTrackIdPattern = /^(?:[0-9]+|sa_[0-9]+|wp-sermon:[0-9]+|cms_[a-z0-9][a-z0-9_-]{0,62})$/;
const blockedInternalSegments = new Set([
  'admin',
  'api',
  'app',
  'archive',
  'compose',
  'content',
  'episodes',
  'feed',
  'login',
  'media',
  'overview',
  'pipeline',
  'podcast',
  'preview',
  'reading-plan',
  'research',
  'sermons',
  'signals',
  'sources',
  'stats',
  'unsubscribe',
  'wp-content',
]);

function record(value: unknown): DocumentRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as DocumentRecord;
  if (source.data && typeof source.data === 'object' && !Array.isArray(source.data)) {
    return record(source.data);
  }
  if (source.attributes && typeof source.attributes === 'object' && !Array.isArray(source.attributes)) {
    return { ...(source.attributes as DocumentRecord), ...source };
  }
  return source;
}

function records(value: unknown): DocumentRecord[] {
  if (Array.isArray(value)) return value.flatMap(records);
  if (!value || typeof value !== 'object') return [];
  const source = value as DocumentRecord;
  if ('data' in source) return records(source.data);
  const normalized = record(value);
  return Object.keys(normalized).length ? [normalized] : [];
}

function text(value: unknown, maximum = 100_000) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function nullableNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function decodedStrictPathname(pathname: string) {
  let decoded = pathname;
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return '';
  }
  if (
    !decoded.startsWith('/') ||
    decoded.startsWith('//') ||
    decoded.includes('\\') ||
    decoded.includes('//') ||
    /%[0-9a-f]{2}/i.test(decoded) ||
    decoded.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    return '';
  }
  return decoded;
}

function safePublicHref(value: unknown) {
  const href = text(value, 2_048);
  if (!href || /[\u0000-\u001f\\]/.test(href) || href.startsWith('//')) return '';
  if (href.startsWith('/')) {
    try {
      const parsed = new URL(href, 'https://www.pastorwood.org');
      const decodedPathname = decodedStrictPathname(parsed.pathname);
      const segment = decodedPathname.match(/^\/([^/]+)/)?.[1]?.toLowerCase() || '';
      if (!decodedPathname || parsed.origin !== 'https://www.pastorwood.org' || blockedInternalSegments.has(segment)) return '';
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return '';
    }
  }
  if (/^#[A-Za-z0-9_-]+$/.test(href)) return href;
  try {
    const parsed = new URL(href);
    if (parsed.username || parsed.password) return '';
    if (parsed.protocol === 'https:') {
      const pastorWoodHost = ['pastorwood.org', 'www.pastorwood.org'].includes(parsed.hostname.toLowerCase());
      const decodedPathname = decodedStrictPathname(parsed.pathname);
      const segment = decodedPathname.match(/^\/([^/]+)/)?.[1]?.toLowerCase() || '';
      return !decodedPathname || (pastorWoodHost && blockedInternalSegments.has(segment)) ? '' : parsed.toString();
    }
    if (parsed.protocol === 'mailto:' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.pathname) && !parsed.search && !parsed.hash) {
      return parsed.toString();
    }
    if (parsed.protocol === 'tel:' && /^\+?[0-9(). -]+$/.test(parsed.pathname) && !parsed.search && !parsed.hash) {
      return parsed.toString();
    }
  } catch {
    // Invalid URLs are omitted from the public projection.
  }
  return '';
}

function safeCanonical(value: unknown) {
  const href = safePublicHref(value);
  return href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:') ? href : '';
}

function safeEpisodeAudioUrl(value: unknown, expectedTrackId: string) {
  const href = text(value, 2_048);
  if (!href.startsWith('/media/episodes/')) return safePublicHref(href);
  if (/[?#\u0000-\u001f\\]/.test(href)) return '';
  try {
    const parsed = new URL(href, 'https://www.pastorwood.org');
    const decodedPathname = decodedStrictPathname(parsed.pathname);
    const match = decodedPathname.match(/^\/media\/episodes\/([^/]+)\/?$/);
    const trackId = match?.[1] || '';
    if (
      parsed.origin !== 'https://www.pastorwood.org'
      || !operationalTrackIdPattern.test(trackId)
      || trackId.length > 100
      || trackId !== expectedTrackId
    ) return '';
    return `/media/episodes/${encodeURIComponent(trackId)}`;
  } catch {
    return '';
  }
}

function safeRedirectSourcePath(value: unknown) {
  const path = text(value, 512);
  if (!path || path === '/' || /[?#\u0000-\u001f\\]/.test(path)) return '';
  const decoded = decodedStrictPathname(path);
  return decoded && decoded === path ? decoded : '';
}

function media(value: unknown): ProjectedMedia | null {
  const source = record(value);
  const documentId = text(source.documentId, 128);
  const rawUrl = text(source.url, 2_048);
  if (!publicIdentityPattern.test(documentId) || !/^\/uploads\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,254}$/.test(rawUrl)) return null;
  try {
    const parsed = new URL(rawUrl, 'http://strapi.invalid');
    if (parsed.pathname !== rawUrl || parsed.search || parsed.hash) return null;
    const filename = parsed.pathname.split('/').filter(Boolean).at(-1) || '';
    if (!filename || filename === '.' || filename === '..') return null;
    return {
      documentId,
      url: parsed.pathname,
      name: text(source.name, 500),
      mime: text(source.mime, 200) || 'application/octet-stream',
      size: nullableNumber(source.size),
      alternativeText: text(source.alternativeText, 500),
      caption: text(source.caption, 2_000),
    };
  } catch {
    return null;
  }
}

function relationDocumentIds(value: unknown) {
  return [...new Set(records(value).map((item) => text(item.documentId, 128)).filter((item) => publicIdentityPattern.test(item)))];
}

function scripture(value: unknown) {
  return records(value).flatMap((item) => {
    const label = text(item.label, 200);
    if (!label) return [];
    return [{
      label,
      book: text(item.book, 100),
      chapter: nullableNumber(item.chapter),
      verseStart: nullableNumber(item.verseStart),
      verseEnd: nullableNumber(item.verseEnd),
      translation: text(item.translation, 30),
      url: safePublicHref(item.url),
    }];
  });
}

function externalLinks(value: unknown) {
  return records(value).flatMap((item) => {
    const label = text(item.label, 200);
    const url = safePublicHref(item.url);
    return label && url ? [{ label, url, description: text(item.description, 2_000) }] : [];
  });
}

function seo(value: unknown) {
  const source = record(value);
  return {
    title: text(source.title, 70),
    description: text(source.description, 180),
    canonicalUrl: safeCanonical(source.canonicalUrl),
    noIndex: boolean(source.noIndex),
    socialImage: media(source.socialImage),
  };
}

function pageSections(value: unknown) {
  return records(value).flatMap((section) => {
    const component = text(section.__component, 100);
    if (!['page-sections.text-section', 'page-sections.image-text-section', 'page-sections.cta-section'].includes(component)) {
      return [];
    }
    return [{
      component,
      eyebrow: text(section.eyebrow, 500),
      heading: text(section.heading, 1_000),
      body: text(section.body),
      buttonLabel: component === 'page-sections.cta-section' ? text(section.buttonLabel, 500) : '',
      buttonUrl: component === 'page-sections.cta-section' ? safePublicHref(section.buttonUrl) : '',
      imageSide: ['none', 'left', 'right'].includes(text(section.imageSide, 10)) ? text(section.imageSide, 10) : '',
      imageDescription: text(section.imageDescription, 500),
      image: component === 'page-sections.image-text-section' ? media(section.image) : null,
    }];
  });
}

function navigation(value: unknown) {
  return records(value).flatMap((item) => {
    const label = text(item.label, 500);
    const pageDocumentId = relationDocumentIds(item.page)[0] || '';
    const url = safePublicHref(item.url);
    if (!label || (!pageDocumentId && !url)) return [];
    return [{
      label,
      url: pageDocumentId ? '' : url,
      pageDocumentId,
      order: nullableNumber(item.order),
      active: boolean(item.active, true),
    }];
  });
}

export function publicProjectionPayload(entityType: PublicProjectionEntityType, document: DocumentRecord) {
  const source = record(document);
  const documentId = text(source.documentId, 128);
  const common = { documentId, publishedAt: text(source.publishedAt, 80) };

  if (entityType === 'page') {
    return {
      ...common,
      title: text(source.title, 1_000),
      slug: text(source.slug, 512).toLowerCase(),
      pageKey: text(source.pageKey, 512).toLowerCase(),
      active: boolean(source.active, true),
      showInNavigation: boolean(source.showInNavigation),
      navigationLabel: text(source.navigationLabel, 500),
      navigationOrder: nullableNumber(source.navigationOrder),
      heroLabel: text(source.heroLabel, 500),
      heroTitle: text(source.heroTitle, 1_000),
      heroBody: text(source.heroBody, 20_000),
      seoTitle: text(source.seoTitle, 70),
      seoDescription: text(source.seoDescription, 180),
      canonicalUrl: safeCanonical(source.canonicalUrl),
      noIndex: boolean(source.noIndex),
      socialImage: media(source.socialImage),
      sections: pageSections(source.sections),
    };
  }

  if (entityType === 'site-setting') {
    return {
      ...common,
      siteName: text(source.siteName, 500) || 'Abiding in Christ',
      topNavigation: navigation(source.topNavigation),
      footerNavigation: navigation(source.footerNavigation),
      utilityNavigation: navigation(source.utilityNavigation),
      footerText: text(source.footerText, 5_000),
      copyrightText: text(source.copyrightText, 1_000),
      showDonateButton: boolean(source.showDonateButton),
      donateButtonLabel: text(source.donateButtonLabel, 500),
      donateButtonUrl: safePublicHref(source.donateButtonUrl),
      donorDashboardUrl: safePublicHref(source.donorDashboardUrl),
      headerLogo: media(source.headerLogo),
      subscriptionEnabled: boolean(source.subscriptionEnabled),
    };
  }

  if (entityType === 'post') {
    return {
      ...common,
      title: text(source.title, 1_000),
      slug: text(source.slug, 512).toLowerCase(),
      contentType: text(source.contentType, 100),
      summary: text(source.summary, 20_000),
      body: text(source.body),
      publishDate: text(source.publishDate, 80) || null,
      authorDocumentId: relationDocumentIds(source.author)[0] || '',
      scriptureReferences: scripture(source.scriptureReferences),
      relatedLinks: externalLinks(source.relatedLinks),
      topics: Array.isArray(source.topics) ? source.topics.map((item) => text(item, 200)).filter(Boolean).slice(0, 100) : [],
      featuredImage: media(source.featuredImage),
      seo: seo(source.seo),
    };
  }

  if (entityType === 'episode') {
    const trackId = text(source.trackId, 100);
    return {
      ...common,
      title: text(source.title, 1_000),
      slug: text(source.slug, 512).toLowerCase(),
      trackId,
      programDate: text(source.programDate, 80) || null,
      summary: text(source.summary, 20_000),
      description: text(source.description),
      audio: media(source.audio),
      externalAudioUrl: safeEpisodeAudioUrl(source.externalAudioUrl, trackId),
      durationSeconds: nullableNumber(source.durationSeconds),
      guestDocumentIds: relationDocumentIds(source.guests),
      scriptureReferences: scripture(source.scriptureReferences),
      featuredImage: media(source.featuredImage),
      seo: seo(source.seo),
    };
  }

  if (entityType === 'person') {
    return {
      ...common,
      name: text(source.name, 1_000),
      slug: text(source.slug, 512).toLowerCase(),
      title: text(source.title, 1_000),
      organization: text(source.organization, 1_000),
      biography: text(source.biography),
      photo: media(source.photo),
      sortOrder: nullableNumber(source.sortOrder) || 0,
      showOnBoard: boolean(source.showOnBoard),
      active: boolean(source.active, true),
      legacyPhotoUrl: safePublicHref(source.legacyPhotoUrl),
    };
  }

  if (entityType === 'endorsement') {
    return {
      ...common,
      quote: text(source.quote, 50_000),
      attribution: text(source.attribution, 1_000),
      title: text(source.title, 1_000),
      organization: text(source.organization, 1_000),
      personDocumentId: relationDocumentIds(source.person)[0] || '',
      photo: media(source.photo),
      sortOrder: nullableNumber(source.sortOrder) || 0,
      featured: boolean(source.featured),
      active: boolean(source.active, true),
      sourceUrl: safePublicHref(source.sourceUrl),
    };
  }

  if (entityType === 'media-asset') {
    return {
      ...common,
      title: text(source.title, 1_000),
      slug: text(source.slug, 512).toLowerCase(),
      asset: media(source.asset),
      assetType: text(source.assetType, 100),
      visibility: text(source.visibility, 50),
      altText: text(source.altText, 500),
      caption: text(source.caption, 2_000),
      credit: text(source.credit, 1_000),
    };
  }

  return {
    ...common,
    fromPath: safeRedirectSourcePath(source.fromPath),
    toPath: safePublicHref(source.toPath),
    statusCode: nullableNumber(source.statusCode),
    active: boolean(source.active, true),
  };
}

function publiclyVisible(entityType: PublicProjectionEntityType, payload: DocumentRecord) {
  if (entityType === 'page' || entityType === 'person' || entityType === 'endorsement' || entityType === 'redirect') {
    return payload.active !== false;
  }
  if (entityType === 'media-asset') return payload.visibility === 'public' && Boolean(payload.asset);
  return true;
}

function identities(entityType: PublicProjectionEntityType, payload: DocumentRecord) {
  const result: Array<{ type: 'slug' | 'track-id' | 'page-key' | 'singleton' | 'path'; value: string }> = [];
  const slug = text(payload.slug, 512).toLowerCase();
  const pageKey = text(payload.pageKey, 512).toLowerCase();
  const trackId = text(payload.trackId, 100);
  if (slug) result.push({ type: 'slug', value: slug });
  if (pageKey) result.push({ type: 'page-key', value: pageKey });
  if (trackId) result.push({ type: 'track-id', value: trackId });
  if (entityType === 'site-setting') result.push({ type: 'singleton', value: 'site-setting' });
  if (entityType === 'redirect') {
    const fromPath = safeRedirectSourcePath(payload.fromPath);
    if (fromPath) result.push({ type: 'path', value: fromPath.toLowerCase() });
  }
  return result;
}

function collectMedia(value: unknown, output: Map<string, ProjectedMedia>) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectMedia(item, output));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const source = value as DocumentRecord;
  if (publicIdentityPattern.test(text(source.documentId, 128)) && text(source.url, 2_048).startsWith('/uploads/')) {
    output.set(String(source.documentId), source as ProjectedMedia);
    return;
  }
  Object.values(source).forEach((item) => collectMedia(item, output));
}

function rawResultRows(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return [];
  const rows = (value as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object') : [];
}

function mediaAllowedForParent(entityType: PublicProjectionEntityType, payload: DocumentRecord) {
  if (entityType === 'person') return payload.active === true && payload.showOnBoard === true;
  if (entityType === 'endorsement' || entityType === 'page') return payload.active === true;
  if (entityType === 'media-asset') return payload.visibility === 'public';
  if (entityType === 'redirect') return false;
  return true;
}

export async function tombstonePublicProjection(
  trx: ProjectionTransaction,
  entityType: PublicProjectionEntityType,
  documentId: string,
  document: DocumentRecord = {},
) {
  const safeDocumentId = text(documentId, 128);
  if (!publicIdentityPattern.test(safeDocumentId)) throw new Error('A valid document id is required for public projection.');
  const payload: DocumentRecord = publicProjectionPayload(entityType, { ...document, documentId: safeDocumentId });
  const currentIdentities = identities(entityType, payload);
  await trx.raw(
    `insert into public.pastorwood_public_projection
      (entity_type, document_id, canonical_slug, canonical_track_id, page_key, payload, is_published, published_at, projected_at, tombstoned_at)
     values (?, ?, ?, ?, ?, null, false, null, now(), now())
     on conflict (entity_type, document_id) do update set
       canonical_slug = coalesce(excluded.canonical_slug, public.pastorwood_public_projection.canonical_slug),
       canonical_track_id = coalesce(excluded.canonical_track_id, public.pastorwood_public_projection.canonical_track_id),
       page_key = coalesce(excluded.page_key, public.pastorwood_public_projection.page_key),
       payload = null,
       is_published = false,
       published_at = null,
       projected_at = now(),
       tombstoned_at = now()`,
    [entityType, safeDocumentId, text(payload.slug, 512) || null, text(payload.trackId, 100) || null, text(payload.pageKey, 512) || null],
  );
  await trx.raw(
    `update public.pastorwood_public_projection_identities
       set is_current = false, updated_at = now()
     where entity_type = ? and document_id = ?`,
    [entityType, safeDocumentId],
  );
  for (const identity of currentIdentities) {
    await trx.raw(
      `insert into public.pastorwood_public_projection_identities
        (entity_type, identity_type, identity_value, document_id, is_current, updated_at)
       values (?, ?, ?, ?, false, now())
       on conflict (entity_type, identity_type, identity_value) do update set
         is_current = false,
         updated_at = now()
       where public.pastorwood_public_projection_identities.document_id = excluded.document_id`,
      [entityType, identity.type, identity.value, safeDocumentId],
    );
  }
  await trx.raw(
    `delete from public.pastorwood_public_projection_media where entity_type = ? and document_id = ?`,
    [entityType, safeDocumentId],
  );
}

export async function projectPublishedDocument(
  trx: ProjectionTransaction,
  entityType: PublicProjectionEntityType,
  documentId: string,
  document: DocumentRecord,
) {
  const safeDocumentId = text(documentId, 128);
  if (!publicIdentityPattern.test(safeDocumentId)) throw new Error('A valid document id is required for public projection.');
  const payload: DocumentRecord = publicProjectionPayload(entityType, { ...document, documentId: safeDocumentId });
  if (!publiclyVisible(entityType, payload)) {
    await tombstonePublicProjection(trx, entityType, safeDocumentId, document);
    return;
  }
  const currentIdentities = identities(entityType, payload);
  await trx.raw(
    `insert into public.pastorwood_public_projection
      (entity_type, document_id, canonical_slug, canonical_track_id, page_key, payload, is_published, published_at, projected_at, tombstoned_at)
     values (?, ?, ?, ?, ?, ?::jsonb, true, coalesce(?::timestamptz, now()), now(), null)
     on conflict (entity_type, document_id) do update set
       canonical_slug = excluded.canonical_slug,
       canonical_track_id = excluded.canonical_track_id,
       page_key = excluded.page_key,
       payload = excluded.payload,
       is_published = true,
       published_at = excluded.published_at,
       projected_at = now(),
       tombstoned_at = null`,
    [
      entityType,
      safeDocumentId,
      text(payload.slug, 512) || null,
      text(payload.trackId, 100) || null,
      text(payload.pageKey, 512) || null,
      JSON.stringify(payload),
      text(payload.publishedAt, 80) || null,
    ],
  );
  await trx.raw(
    `update public.pastorwood_public_projection_identities
       set is_current = false, updated_at = now()
     where entity_type = ? and document_id = ?`,
    [entityType, safeDocumentId],
  );
  for (const identity of currentIdentities) {
    const identityWrite = await trx.raw(
      `insert into public.pastorwood_public_projection_identities
        (entity_type, identity_type, identity_value, document_id, is_current, updated_at)
       values (?, ?, ?, ?, true, now())
       on conflict (entity_type, identity_type, identity_value) do update set
         document_id = excluded.document_id,
         is_current = true,
         updated_at = now()
       where public.pastorwood_public_projection_identities.document_id = excluded.document_id
          or public.pastorwood_public_projection_identities.is_current = false
       returning document_id`,
      [entityType, identity.type, identity.value, safeDocumentId],
    );
    if (rawResultRows(identityWrite).length !== 1) {
      throw new Error(`Public ${entityType} identity is already owned by another published document.`);
    }
  }
  await trx.raw(
    `delete from public.pastorwood_public_projection_media where entity_type = ? and document_id = ?`,
    [entityType, safeDocumentId],
  );
  if (!mediaAllowedForParent(entityType, payload)) return;
  const projectedMedia = new Map<string, ProjectedMedia>();
  collectMedia(payload, projectedMedia);
  for (const item of projectedMedia.values()) {
    const sizeBytes = item.size === null ? null : Math.max(0, Math.round(item.size * 1_024));
    await trx.raw(
      `insert into public.pastorwood_public_projection_media
        (media_document_id, entity_type, document_id, media_url, mime_type, size_bytes, projected_at)
       values (?, ?, ?, ?, ?, ?, now())`,
      [item.documentId, entityType, safeDocumentId, item.url, item.mime, sizeBytes],
    );
  }
}
