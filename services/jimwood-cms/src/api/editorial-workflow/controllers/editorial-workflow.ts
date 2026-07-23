import type { Core } from '@strapi/strapi';

import {
  snapshotForRevision,
  writableSnapshot as buildWritableSnapshot,
  type AttributeSchema,
  type SnapshotSchemaResolver,
} from './editorial-snapshot';
import {
  projectPublishedDocument,
  tombstonePublicProjection,
  type ProjectionTransaction,
} from './public-projection';
import {
  validatePastorWoodRedirectGraph,
  type NormalizedPastorWoodRedirectRule,
  type PastorWoodRedirectRule,
} from '../../../shared/pastorwood-redirect-policy';

declare const strapi: Core.Strapi;

type Actor = {
  id: string;
  email: string;
  name?: string;
};

type WorkflowBody = {
  actor?: Actor;
  data?: Record<string, unknown>;
  note?: string;
  revisionDocumentId?: string;
  expectedTitle?: string;
  expectedUpdatedAt?: string;
};

type DocumentRecord = Record<string, unknown>;
type DocumentService = {
  findOne(params: Record<string, unknown>): Promise<DocumentRecord | null>;
  findMany(params: Record<string, unknown>): Promise<DocumentRecord[]>;
  create(params: Record<string, unknown>): Promise<DocumentRecord>;
  update(params: Record<string, unknown>): Promise<DocumentRecord>;
  publish(params: Record<string, unknown>): Promise<{ entries?: DocumentRecord[] }>;
  unpublish(params: Record<string, unknown>): Promise<{ entries?: DocumentRecord[] }>;
  delete(params: Record<string, unknown>): Promise<{ entries?: DocumentRecord[] }>;
};

type EditorialContext = {
  params: Record<string, string | undefined>;
  query?: Record<string, unknown>;
  request?: { body?: unknown };
  status: number;
  body: unknown;
  badRequest(message: string, details?: Record<string, unknown>): unknown;
  notFound(message: string, details?: Record<string, unknown>): unknown;
};

type ContentTypeSchema = {
  attributes: Record<string, AttributeSchema>;
};

const entityModels = {
  page: {
    uid: 'api::page.page', titleField: 'title', publishable: true,
    populate: { sections: { populate: '*' }, socialImage: true },
  },
  post: {
    uid: 'api::post.post', titleField: 'title', publishable: true,
    populate: {
      author: true,
      scriptureReferences: true,
      relatedLinks: true,
      featuredImage: true,
      seo: { populate: { socialImage: true } },
    },
  },
  episode: {
    uid: 'api::episode.episode', titleField: 'title', publishable: true,
    populate: {
      audio: true,
      featuredImage: true,
      guests: true,
      scriptureReferences: true,
      seo: { populate: { socialImage: true } },
    },
  },
  person: { uid: 'api::person.person', titleField: 'name', publishable: true, populate: { photo: true } },
  endorsement: {
    uid: 'api::endorsement.endorsement', titleField: 'attribution', publishable: true,
    populate: { person: true, photo: true },
  },
  'media-asset': {
    uid: 'api::media-asset.media-asset', titleField: 'title', publishable: true, populate: { asset: true },
  },
  redirect: { uid: 'api::redirect.redirect', titleField: 'fromPath', publishable: false },
  'site-setting': {
    uid: 'api::site-setting.site-setting',
    titleField: 'siteName',
    publishable: true,
    populate: {
      headerLogo: true,
      topNavigation: { populate: { page: true } },
      footerNavigation: { populate: { page: true } },
      utilityNavigation: { populate: { page: true } },
    },
  },
} as const;

type EntityType = keyof typeof entityModels;
type EditorialAction = 'baseline' | 'create' | 'save' | 'publish' | 'unpublish' | 'archive' | 'restore' | 'rollback' | 'delete' | 'upload';
type WorkflowAction = EditorialAction | 'publish-scheduled' | 'retry-processing';

const revisionUid = 'api::editorial-revision.editorial-revision';
const eventUid = 'api::editorial-event.editorial-event';
const processingRequestUid = 'api::episode-processing-request.episode-processing-request';
const operationalTrackIdPattern = /^(?:[0-9]+|sa_[0-9]+|wp-sermon:[0-9]+|cms_[a-z0-9][a-z0-9_-]{0,62})$/;

function modelFor(value: string | undefined) {
  if (!value || !(value in entityModels)) {
    return null;
  }
  return entityModels[value as EntityType];
}

function requireActor(value: Actor | undefined) {
  if (!value?.id?.trim() || !value.email?.trim()) {
    throw new Error('An authenticated editor identity is required.');
  }
  return {
    id: value.id.trim(),
    email: value.email.trim().toLowerCase(),
    name: value.name?.trim() || '',
  };
}

function documents(uid: string): DocumentService {
  return strapi.documents(uid as never) as unknown as DocumentService;
}

function contentTypeAttributes(uid: string) {
  return (strapi.contentType(uid as never) as unknown as ContentTypeSchema).attributes;
}

function componentTypeAttributes(uid: string) {
  const components = strapi.components as unknown as Record<string, ContentTypeSchema>;
  return components[uid]?.attributes || {};
}

const snapshotSchemaResolver: SnapshotSchemaResolver = {
  contentTypeAttributes,
  componentTypeAttributes,
};

function writableSnapshot(uid: string, snapshot: Record<string, unknown>) {
  return buildWritableSnapshot(uid, snapshot, snapshotSchemaResolver);
}

function editorialPopulate(model: (typeof entityModels)[EntityType]) {
  return 'populate' in model ? model.populate : '*';
}

async function withEditorialTransaction<T>(
  entityType: EntityType,
  documentId: string,
  callback: (trx: ProjectionTransaction) => Promise<T>,
) {
  return strapi.db.transaction(async ({ trx }: { trx: ProjectionTransaction }) => {
    const databaseClient = String(strapi.db.config.connection.client || '');
    const lockIdentity = entityType === 'redirect'
      ? 'pastorwood-editorial:redirect-graph'
      : documentId
        ? `pastorwood-editorial:${entityType}:${documentId}`
        : '';
    if (lockIdentity && databaseClient.includes('postgres')) {
      await trx.raw(
        'select pg_advisory_xact_lock(hashtextextended(?, 0))',
        [lockIdentity],
      );
    }
    return callback(trx as unknown as ProjectionTransaction);
  });
}

async function findDraft(model: (typeof entityModels)[EntityType], documentId: string) {
  return documents(model.uid).findOne({
    documentId,
    status: 'draft',
    populate: editorialPopulate(model),
  });
}

async function listActiveRedirectRules() {
  const rules: DocumentRecord[] = [];
  const pageSize = 100;
  const maximumRules = 10_000;
  for (let start = 0; start < maximumRules; start += pageSize) {
    const batch = await documents(entityModels.redirect.uid).findMany({
      filters: { active: true, archivedAt: { $null: true } },
      sort: ['documentId:asc'],
      start,
      limit: pageSize,
    });
    rules.push(...batch);
    if (batch.length < pageSize) return rules;
  }
  const overflow = await documents(entityModels.redirect.uid).findMany({
    filters: { active: true, archivedAt: { $null: true } },
    sort: ['documentId:asc'],
    start: maximumRules,
    limit: 1,
  });
  if (overflow.length > 0) throw new Error('Active redirect inventory exceeds the 10,000-rule safety bound.');
  return rules;
}

function applyNormalizedRedirectData(
  data: Record<string, unknown>,
  rule: NormalizedPastorWoodRedirectRule,
) {
  data.fromPath = rule.fromPath;
  data.toPath = rule.toPath;
  data.statusCode = rule.statusCode;
  data.active = rule.active;
}

async function validateRedirectMutation(
  ctx: EditorialContext,
  documentId: string,
  current: DocumentRecord | null,
  data: Record<string, unknown>,
) {
  const candidate = {
    ...(current || {}),
    ...data,
    documentId,
  } as PastorWoodRedirectRule;
  const preliminary = validatePastorWoodRedirectGraph(candidate, []);
  if (!preliminary.ok) {
    ctx.badRequest(preliminary.message, { code: `EDITORIAL_REDIRECT_${preliminary.code.toUpperCase().replace(/-/g, '_')}` });
    return false;
  }
  if (!preliminary.rule.active || preliminary.rule.archivedAt) {
    applyNormalizedRedirectData(data, preliminary.rule);
    return true;
  }
  const result = validatePastorWoodRedirectGraph(
    candidate,
    await listActiveRedirectRules() as unknown as PastorWoodRedirectRule[],
  );
  if (!result.ok) {
    ctx.badRequest(result.message, { code: `EDITORIAL_REDIRECT_${result.code.toUpperCase().replace(/-/g, '_')}` });
    return false;
  }
  applyNormalizedRedirectData(data, result.rule);
  return true;
}

async function revisionNumber(entityType: EntityType, entityDocumentId: string) {
  const revisions = await documents(revisionUid).findMany({
    filters: { entityType, entityDocumentId },
    sort: ['revisionNumber:desc'],
    limit: 1,
  });
  return Number(revisions[0]?.revisionNumber || 0) + 1;
}

async function recordAction(
  entityType: EntityType,
  model: (typeof entityModels)[EntityType],
  documentId: string,
  document: DocumentRecord,
  action: EditorialAction,
  actorInput: Actor | undefined,
  note = '',
  detail: Record<string, unknown> = {},
) {
  const actor = requireActor(actorInput);
  const titleValue = document[model.titleField];
  const entityTitle = typeof titleValue === 'string' ? titleValue : '';
  const nextRevision = await revisionNumber(entityType, documentId);
  const snapshot = snapshotForRevision(document);

  await documents(revisionUid).create({
    data: {
      entityType,
      entityDocumentId: documentId,
      entityTitle,
      revisionNumber: nextRevision,
      snapshot,
      action,
      actorId: actor.id,
      actorEmail: actor.email,
      actorName: actor.name,
      note,
      source: 'aic-content-manager',
    },
  });

  await documents(eventUid).create({
    data: {
      entityType,
      entityDocumentId: documentId,
      entityTitle,
      action,
      actorId: actor.id,
      actorEmail: actor.email,
      actorName: actor.name,
      note,
      detail,
      source: 'aic-content-manager',
    },
  });

  return nextRevision;
}

function boundedText(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function operationalTrackId(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }
  const trackId = value.trim();
  return trackId.length <= 100 && operationalTrackIdPattern.test(trackId) ? trackId : '';
}

function cutoverSourceFingerprint(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }
  const fingerprint = value.trim();
  return /^[0-9a-f]{64}$/.test(fingerprint) ? fingerprint : '';
}

function isCutoverMetadataOnlyEpisode(document: DocumentRecord) {
  return boundedText(document.archiveReason, 2_000).startsWith('CUTOVER_METADATA_ONLY:');
}

function mediaPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.data && typeof record.data === 'object') {
    return mediaPayload(record.data);
  }
  if (record.attributes && typeof record.attributes === 'object') {
    return mediaPayload({ ...(record.attributes as Record<string, unknown>), ...record });
  }
  const url = boundedText(record.url, 2_000);
  if (!url) {
    return null;
  }
  return {
    url,
    name: boundedText(record.name, 500),
    mime: boundedText(record.mime, 200),
    size: typeof record.size === 'number' ? record.size : null,
  };
}

async function enqueueEpisodeProcessing(
  documentId: string,
  episode: DocumentRecord,
  revisionNumber: number,
  actorInput: Actor | undefined,
) {
  const actor = requireActor(actorInput);
  const trackId = operationalTrackId(episode.trackId);
  if (!trackId) {
    throw new Error('Episode publication requires a valid permanent Track ID.');
  }

  const superseded = await documents(processingRequestUid).findMany({
    filters: {
      episodeDocumentId: documentId,
      status: { $in: ['queued', 'running', 'failed'] },
    },
    limit: 100,
  });
  for (const request of superseded) {
    await documents(processingRequestUid).update({
      documentId: request.documentId,
      data: {
        status: 'superseded',
        claimedAt: null,
        workerId: '',
        completedAt: new Date().toISOString(),
        lastError: `Superseded by publication revision ${revisionNumber}.`,
      },
    });
  }

  await documents(processingRequestUid).create({
    data: {
      requestKey: `${documentId}:revision:${revisionNumber}`,
      episodeDocumentId: documentId,
      trackId,
      revisionNumber,
      status: 'queued',
      attemptCount: 0,
      forceReprocess: false,
      nextAttemptAt: new Date().toISOString(),
      workerId: '',
      lastError: '',
      payload: {
        trackId,
        title: boundedText(episode.title, 1_000),
        programDate: boundedText(episode.programDate, 40),
        publishDate: boundedText(episode.publishDate, 80),
        summary: boundedText(episode.summary, 20_000),
        description: boundedText(episode.description, 100_000),
        externalAudioUrl: boundedText(episode.externalAudioUrl, 2_000),
        audio: mediaPayload(episode.audio),
        sourceFingerprint: cutoverSourceFingerprint(episode.sourceFingerprint),
        sourceUpdatedAt: boundedText(episode.updatedAt, 80),
      },
      result: {},
      requestedBy: actor.email,
    },
  });
}

async function hasPermanentEpisodeIdentity(documentId: string, episode: DocumentRecord) {
  if (boundedText(episode.sourceFingerprint, 500)) {
    return true;
  }
  const published = await documents(entityModels.episode.uid).findOne({ documentId, status: 'published' });
  if (published) {
    return true;
  }
  const requests = await documents(processingRequestUid).findMany({
    filters: { episodeDocumentId: documentId },
    limit: 1,
  });
  if (requests.length > 0) {
    return true;
  }
  const publicationRevisions = await documents(revisionUid).findMany({
    filters: { entityType: 'episode', entityDocumentId: documentId, action: 'publish' },
    limit: 1,
  });
  return publicationRevisions.length > 0;
}

function requestBody(ctx: EditorialContext): WorkflowBody {
  const candidate = ctx.request?.body;
  return candidate && typeof candidate === 'object' ? candidate as WorkflowBody : {};
}

function versionMatches(
  ctx: EditorialContext,
  current: DocumentRecord,
  input: WorkflowBody,
  entityType: EntityType,
) {
  const expectedUpdatedAt = typeof input.expectedUpdatedAt === 'string' ? input.expectedUpdatedAt.trim() : '';
  const currentUpdatedAt = typeof current.updatedAt === 'string' ? current.updatedAt : '';
  if (!expectedUpdatedAt || !currentUpdatedAt || expectedUpdatedAt !== currentUpdatedAt) {
    ctx.badRequest(
      entityType === 'site-setting'
        ? 'Site settings changed after this editor was loaded. Reload before saving.'
        : 'This content item changed after this editor was loaded. Reload before saving.',
      { code: 'EDITORIAL_VERSION_CONFLICT' },
    );
    return false;
  }
  return true;
}

const editorialWorkflowController = {
  async create(ctx: EditorialContext) {
    const entityType = ctx.params.entityType as EntityType;
    const model = modelFor(entityType);
    if (!model) {
      return ctx.badRequest('Unsupported editorial content type.');
    }

    const input = requestBody(ctx);
    const actor = requireActor(input.actor);
    if (!input.data || typeof input.data !== 'object') {
      return ctx.badRequest('Content data is required.');
    }

    return withEditorialTransaction(entityType, entityType === 'site-setting' ? 'singleton' : '', async (trx) => {
      if (entityType === 'site-setting') {
        const existing = await strapi.db.query(model.uid as never).findOne();
        if (existing) {
          return ctx.badRequest('Site settings have already been initialized.');
        }
      }
      if (entityType === 'redirect' && !await validateRedirectMutation(
        ctx,
        '',
        null,
        input.data as Record<string, unknown>,
      )) {
        return;
      }
      const created = await documents(model.uid).create({
        data: input.data,
        status: 'draft',
        populate: editorialPopulate(model),
      });
      const documentId = String(created.documentId);
      await recordAction(entityType, model, documentId, created, 'create', actor, input.note);
      if (entityType === 'redirect') {
        await projectPublishedDocument(trx, entityType, documentId, created);
      }
      ctx.status = 201;
      ctx.body = { data: created };
    });
  },

  async update(ctx: EditorialContext) {
    const entityType = ctx.params.entityType as EntityType;
    const model = modelFor(entityType);
    if (!model) {
      return ctx.badRequest('Unsupported editorial content type.');
    }

    const input = requestBody(ctx);
    const actor = requireActor(input.actor);
    const documentId = String(ctx.params.documentId || '');
    if (!documentId || !input.data || typeof input.data !== 'object') {
      return ctx.badRequest('Document id and content data are required.');
    }
    const data = input.data;

    return withEditorialTransaction(entityType, documentId, async (trx) => {
      const current = await findDraft(model, documentId);
      if (!current) {
        return ctx.notFound('Content item was not found.');
      }
      if (!versionMatches(ctx, current, input, entityType)) {
        return;
      }
      if (entityType === 'page') {
        const requestedPageKey = data.pageKey;
        if (typeof requestedPageKey === 'string' && requestedPageKey !== current.pageKey) {
          return ctx.badRequest('Page identity cannot be changed after creation.');
        }
        data.pageKey = current.pageKey;
      }
      if (entityType === 'episode' && Object.prototype.hasOwnProperty.call(data, 'trackId')) {
        const requestedTrackId = operationalTrackId(data.trackId);
        if (!requestedTrackId) {
          return ctx.badRequest('Episode Track ID is invalid or longer than 100 characters.');
        }
        if (requestedTrackId !== current.trackId && await hasPermanentEpisodeIdentity(documentId, current)) {
          return ctx.badRequest('Track ID cannot change after an episode has been published.');
        }
      }
      if (entityType === 'redirect' && !await validateRedirectMutation(ctx, documentId, current, data)) {
        return;
      }

      const updated = await documents(model.uid).update({
        documentId,
        data,
        status: 'draft',
        populate: editorialPopulate(model),
      });
      await recordAction(entityType, model, documentId, updated, 'save', actor, input.note);
      if (entityType === 'redirect') {
        await projectPublishedDocument(trx, entityType, documentId, updated);
      }
      ctx.body = { data: updated };
    });
  },

  async transition(ctx: EditorialContext) {
    const entityType = ctx.params.entityType as EntityType;
    const model = modelFor(entityType);
    if (!model) {
      return ctx.badRequest('Unsupported editorial content type.');
    }

    const input = requestBody(ctx);
    const actor = requireActor(input.actor);
    const documentId = String(ctx.params.documentId || '');
    const action = String(ctx.params.action || '') as WorkflowAction;
    if (!documentId) {
      return ctx.badRequest('Document id is required.');
    }

    return withEditorialTransaction(entityType, documentId, async (trx) => {
      let current = await findDraft(model, documentId);
      if (!current) {
        return ctx.notFound('Content item was not found.', { code: 'EDITORIAL_NOT_FOUND' });
      }

      if (action === 'baseline') {
        const existingRevisions = await documents(revisionUid).findMany({
          filters: { entityType, entityDocumentId: documentId },
          limit: 1,
        });
        const adopted = existingRevisions.length === 0;
        if (adopted) {
          await recordAction(entityType, model, documentId, current, action, actor, input.note, {
            adoptedExisting: true,
          });
        }
        ctx.body = { data: current, adopted };
        return;
      }

      if (!versionMatches(ctx, current, input, entityType)) {
        return;
      }

      if (entityType === 'site-setting' && (action === 'publish' || action === 'unpublish')) {
        if (!input.data || typeof input.data !== 'object') {
          return ctx.badRequest('Site settings data is required for an atomic publication transition.');
        }
        current = await documents(model.uid).update({
          documentId,
          data: input.data,
          status: 'draft',
          populate: editorialPopulate(model),
        });
        await recordAction(entityType, model, documentId, current, 'save', actor, input.note);
      }

      if (action === 'publish-scheduled') {
        if (!['page', 'post', 'episode'].includes(entityType)) {
          return ctx.badRequest('Scheduled publication is only available for pages, posts, and episodes.');
        }
        if (!model.publishable || current.archivedAt) {
          return ctx.badRequest(
            'This content item is not eligible for scheduled publication.',
            { code: 'EDITORIAL_SCHEDULE_INELIGIBLE' },
          );
        }
        const scheduledFor = typeof current.scheduledFor === 'string' ? current.scheduledFor : '';
        const scheduledAt = Date.parse(scheduledFor);
        if (!scheduledFor || !Number.isFinite(scheduledAt) || scheduledAt > Date.now()) {
          return ctx.badRequest(
            'This content item is not due for scheduled publication.',
            { code: 'EDITORIAL_SCHEDULE_NOT_DUE' },
          );
        }
        if (entityType === 'episode' && !operationalTrackId(current.trackId)) {
          return ctx.badRequest(
            'Episode publication requires a valid permanent Track ID.',
            { code: 'EDITORIAL_INVALID_TRACK_ID' },
          );
        }
        if (entityType === 'episode' && isCutoverMetadataOnlyEpisode(current)) {
          return ctx.badRequest(
            'This imported episode has no verified public audio and cannot be published.',
            { code: 'EDITORIAL_MISSING_PUBLIC_AUDIO' },
          );
        }
        const scheduleUpdate: Record<string, unknown> = { scheduledFor: null };
        if (contentTypeAttributes(model.uid).publishDate && !current.publishDate) {
          scheduleUpdate.publishDate = scheduledFor;
        }
        current = await documents(model.uid).update({
          documentId,
          data: scheduleUpdate,
          status: 'draft',
          populate: editorialPopulate(model),
        });
        const result = await documents(model.uid).publish({ documentId, populate: editorialPopulate(model) });
        const published = result.entries?.[0] || current;
        const revisionNumber = await recordAction(
          entityType,
          model,
          documentId,
          published,
          'publish',
          actor,
          input.note || 'Published automatically at the scheduled time.',
          { scheduled: true, scheduledFor },
        );
        if (entityType === 'episode') {
          await enqueueEpisodeProcessing(documentId, published, revisionNumber, actor);
        }
        await projectPublishedDocument(trx, entityType, documentId, published);
        ctx.body = { data: published };
        return;
      }

      if (action === 'publish') {
        if (!model.publishable) {
          return ctx.badRequest('This content type does not use draft publishing.');
        }
        if (current.archivedAt) {
          return ctx.badRequest('Archived content must be restored before it can be published.');
        }
        if (entityType === 'episode' && !operationalTrackId(current.trackId)) {
          return ctx.badRequest('Episode publication requires a valid permanent Track ID.');
        }
        if (entityType === 'episode' && isCutoverMetadataOnlyEpisode(current)) {
          return ctx.badRequest(
            'This imported episode has no verified public audio and cannot be published.',
            { code: 'EDITORIAL_MISSING_PUBLIC_AUDIO' },
          );
        }
        if (current.scheduledFor) {
          current = await documents(model.uid).update({
            documentId,
            data: { scheduledFor: null },
            status: 'draft',
            populate: editorialPopulate(model),
          });
        }
        const result = await documents(model.uid).publish({ documentId, populate: editorialPopulate(model) });
        const published = result.entries?.[0] || current;
        const revisionNumber = await recordAction(entityType, model, documentId, published, action, actor, input.note);
        if (entityType === 'episode') {
          await enqueueEpisodeProcessing(documentId, published, revisionNumber, actor);
        }
        await projectPublishedDocument(trx, entityType, documentId, published);
        ctx.body = { data: published };
        return;
      }

      if (action === 'retry-processing') {
        if (entityType !== 'episode') {
          return ctx.badRequest('Processing retry is only available for episodes.');
        }
        const requests = await documents(processingRequestUid).findMany({
          filters: { episodeDocumentId: documentId },
          sort: ['createdAt:desc'],
          limit: 1,
        });
        const request = requests[0];
        if (!request) {
          return ctx.badRequest('Publish this episode before requesting processing.');
        }
        if (request.status === 'superseded') {
          return ctx.badRequest('A superseded request cannot replace the newer publication request.');
        }
        if (request.status === 'queued' || request.status === 'running') {
          return ctx.badRequest('Episode processing is already queued or running.');
        }
        const retryNote = boundedText(input.note, 2_000);
        if (!retryNote) {
          return ctx.badRequest('A processing retry note is required.');
        }
        const retried = await documents(processingRequestUid).update({
          documentId: request.documentId,
          data: {
            status: 'queued',
            attemptCount: 0,
            forceReprocess: true,
            nextAttemptAt: new Date().toISOString(),
            claimedAt: null,
            workerId: '',
            lastError: '',
            result: {},
            completedAt: null,
          },
        });
        const retryActor = requireActor(actor);
        await documents(eventUid).create({
          data: {
            entityType,
            entityDocumentId: documentId,
            entityTitle: boundedText(current.title, 1_000),
            action: 'episode_processing_retry',
            actorId: retryActor.id,
            actorEmail: retryActor.email,
            actorName: retryActor.name,
            note: retryNote,
            detail: { processingRequestDocumentId: request.documentId },
            source: 'aic-content-manager',
          },
        });
        ctx.body = { data: retried };
        return;
      }

      if (action === 'unpublish') {
        if (!model.publishable) {
          return ctx.badRequest('This content type does not use draft publishing.');
        }
        await documents(model.uid).unpublish({ documentId, populate: editorialPopulate(model) });
        const draft = (await findDraft(model, documentId)) || current;
        await recordAction(entityType, model, documentId, draft, action, actor, input.note);
        await tombstonePublicProjection(trx, entityType, documentId, draft);
        ctx.body = { data: draft };
        return;
      }

      if (action === 'archive') {
        const data: Record<string, unknown> = {
          archivedAt: new Date().toISOString(),
          archiveReason: input.note || '',
        };
        if (contentTypeAttributes(model.uid).active) {
          data.active = false;
        }
        if (contentTypeAttributes(model.uid).scheduledFor) {
          data.scheduledFor = null;
        }
        const archived = await documents(model.uid).update({ documentId, data, status: 'draft', populate: editorialPopulate(model) });
        if (model.publishable) {
          await documents(model.uid).unpublish({ documentId, populate: editorialPopulate(model) });
        }
        await recordAction(entityType, model, documentId, archived, action, actor, input.note);
        await tombstonePublicProjection(trx, entityType, documentId, archived);
        ctx.body = { data: archived };
        return;
      }

      if (action === 'restore') {
        const data: Record<string, unknown> = { archivedAt: null, archiveReason: null };
        if (contentTypeAttributes(model.uid).active) {
          data.active = true;
        }
        if (entityType === 'redirect' && !await validateRedirectMutation(ctx, documentId, current, data)) {
          return;
        }
        const restored = await documents(model.uid).update({ documentId, data, status: 'draft', populate: editorialPopulate(model) });
        await recordAction(entityType, model, documentId, restored, action, actor, input.note);
        if (entityType === 'redirect') {
          await projectPublishedDocument(trx, entityType, documentId, restored);
        }
        ctx.body = { data: restored };
        return;
      }

      if (action === 'rollback') {
        if (!input.revisionDocumentId) {
          return ctx.badRequest('A revision id is required for rollback.');
        }
        const revision = await documents(revisionUid).findOne({
          documentId: input.revisionDocumentId,
        });
        if (!revision || revision.entityType !== entityType || revision.entityDocumentId !== documentId) {
          return ctx.badRequest('The requested revision does not belong to this item.');
        }
        const data = writableSnapshot(model.uid, revision.snapshot as Record<string, unknown>);
        if (entityType === 'page') {
          data.pageKey = current.pageKey;
        }
        if (entityType === 'episode' && await hasPermanentEpisodeIdentity(documentId, current)) {
          data.trackId = current.trackId;
        }
        if (entityType === 'redirect' && !await validateRedirectMutation(ctx, documentId, current, data)) {
          return;
        }
        const restored = await documents(model.uid).update({ documentId, data, status: 'draft', populate: editorialPopulate(model) });
        await recordAction(
          entityType,
          model,
          documentId,
          restored,
          action,
          actor,
          input.note,
          { restoredRevision: revision.revisionNumber },
        );
        if (entityType === 'redirect') {
          await projectPublishedDocument(trx, entityType, documentId, restored);
        }
        ctx.body = { data: restored };
        return;
      }

      if (action === 'delete') {
        const expectedTitle = typeof input.expectedTitle === 'string' ? input.expectedTitle : '';
        const currentTitleValue = current[model.titleField];
        const currentTitle = typeof currentTitleValue === 'string' ? currentTitleValue : '';
        if (!expectedTitle || expectedTitle !== currentTitle) {
          return ctx.badRequest('Deletion confirmation no longer matches the current item title.');
        }
        await recordAction(entityType, model, documentId, current, action, actor, input.note);
        await tombstonePublicProjection(trx, entityType, documentId, current);
        await documents(model.uid).delete({ documentId });
        ctx.body = { data: { documentId, deleted: true } };
        return;
      }

      return ctx.badRequest('Unsupported editorial action.');
    });
  },

  async revisions(ctx: EditorialContext) {
    const entityType = ctx.params.entityType as EntityType;
    if (!modelFor(entityType)) {
      return ctx.badRequest('Unsupported editorial content type.');
    }

    const documentId = String(ctx.params.documentId || '');
    const requestedPage = Number(ctx.query?.page || 1);
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize = 100;
    const data = await documents(revisionUid).findMany({
      filters: { entityType, entityDocumentId: documentId },
      sort: ['revisionNumber:desc'],
      start: (page - 1) * pageSize,
      limit: pageSize,
    });
    ctx.body = { data };
  },
};

export default editorialWorkflowController;
