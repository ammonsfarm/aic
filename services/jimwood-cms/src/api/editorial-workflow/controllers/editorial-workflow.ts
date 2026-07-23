import type { Core } from '@strapi/strapi';

import {
  snapshotForRevision,
  writableSnapshot as buildWritableSnapshot,
  type AttributeSchema,
  type SnapshotSchemaResolver,
} from './editorial-snapshot';

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
  badRequest(message: string): unknown;
  notFound(message: string): unknown;
};

type ContentTypeSchema = {
  attributes: Record<string, AttributeSchema>;
};

const entityModels = {
  page: { uid: 'api::page.page', titleField: 'title', publishable: true },
  post: { uid: 'api::post.post', titleField: 'title', publishable: true },
  episode: { uid: 'api::episode.episode', titleField: 'title', publishable: true },
  person: { uid: 'api::person.person', titleField: 'name', publishable: true },
  endorsement: { uid: 'api::endorsement.endorsement', titleField: 'attribution', publishable: true },
  'media-asset': { uid: 'api::media-asset.media-asset', titleField: 'title', publishable: true },
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
type WorkflowAction = EditorialAction | 'retry-processing';

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
  callback: () => Promise<T>,
) {
  return strapi.db.transaction(async ({ trx }) => {
    const databaseClient = String(strapi.db.config.connection.client || '');
    if (documentId && databaseClient.includes('postgres')) {
      await trx.raw(
        'select pg_advisory_xact_lock(hashtextextended(?, 0))',
        [`pastorwood-editorial:${entityType}:${documentId}`],
      );
    }
    return callback();
  });
}

async function findDraft(model: (typeof entityModels)[EntityType], documentId: string) {
  return documents(model.uid).findOne({
    documentId,
    status: 'draft',
    populate: editorialPopulate(model),
  });
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
  const trackId = boundedText(episode.trackId, 100);
  if (!operationalTrackIdPattern.test(trackId)) {
    throw new Error('Episode publication requires a valid permanent Track ID.');
  }

  const superseded = await documents(processingRequestUid).findMany({
    filters: {
      episodeDocumentId: documentId,
      status: { $in: ['queued', 'failed'] },
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

function siteSettingsVersionMatches(
  ctx: EditorialContext,
  current: DocumentRecord,
  input: WorkflowBody,
) {
  const expectedUpdatedAt = typeof input.expectedUpdatedAt === 'string' ? input.expectedUpdatedAt.trim() : '';
  const currentUpdatedAt = typeof current.updatedAt === 'string' ? current.updatedAt : '';
  if (!expectedUpdatedAt || !currentUpdatedAt || expectedUpdatedAt !== currentUpdatedAt) {
    ctx.badRequest('Site settings changed after this editor was loaded. Reload before saving.');
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

    return withEditorialTransaction(entityType, entityType === 'site-setting' ? 'singleton' : '', async () => {
      if (entityType === 'site-setting') {
        const existing = await strapi.db.query(model.uid as never).findOne();
        if (existing) {
          return ctx.badRequest('Site settings have already been initialized.');
        }
      }
      const created = await documents(model.uid).create({
        data: input.data,
        status: 'draft',
        populate: editorialPopulate(model),
      });
      const documentId = String(created.documentId);
      await recordAction(entityType, model, documentId, created, 'create', actor, input.note);
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

    return withEditorialTransaction(entityType, documentId, async () => {
      const current = await findDraft(model, documentId);
      if (!current) {
        return ctx.notFound('Content item was not found.');
      }
      if (entityType === 'page') {
        const requestedPageKey = data.pageKey;
        if (typeof requestedPageKey === 'string' && requestedPageKey !== current.pageKey) {
          return ctx.badRequest('Page identity cannot be changed after creation.');
        }
        data.pageKey = current.pageKey;
      } else if (entityType === 'site-setting' && !siteSettingsVersionMatches(ctx, current, input)) {
        return;
      }
      if (entityType === 'episode' && Object.prototype.hasOwnProperty.call(data, 'trackId')) {
        const requestedTrackId = boundedText(data.trackId, 100);
        if (requestedTrackId !== current.trackId && await hasPermanentEpisodeIdentity(documentId, current)) {
          return ctx.badRequest('Track ID cannot change after an episode has been published.');
        }
      }

      const updated = await documents(model.uid).update({
        documentId,
        data,
        status: 'draft',
        populate: editorialPopulate(model),
      });
      await recordAction(entityType, model, documentId, updated, 'save', actor, input.note);
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

    return withEditorialTransaction(entityType, documentId, async () => {
      let current = await findDraft(model, documentId);
      if (!current) {
        return ctx.notFound('Content item was not found.');
      }

      if (action === 'baseline') {
        if (entityType !== 'site-setting') {
          return ctx.badRequest('Baseline adoption is only available for site settings.');
        }
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

      if (entityType === 'site-setting' && (action === 'publish' || action === 'unpublish')) {
        if (!input.data || typeof input.data !== 'object') {
          return ctx.badRequest('Site settings data is required for an atomic publication transition.');
        }
        if (!siteSettingsVersionMatches(ctx, current, input)) {
          return;
        }
        current = await documents(model.uid).update({
          documentId,
          data: input.data,
          status: 'draft',
          populate: editorialPopulate(model),
        });
        await recordAction(entityType, model, documentId, current, 'save', actor, input.note);
      } else if (entityType === 'site-setting' && action === 'rollback' && !siteSettingsVersionMatches(ctx, current, input)) {
        return;
      }

      if (action === 'publish') {
        if (!model.publishable) {
          return ctx.badRequest('This content type does not use draft publishing.');
        }
        if (current.archivedAt) {
          return ctx.badRequest('Archived content must be restored before it can be published.');
        }
        if (entityType === 'episode' && !operationalTrackIdPattern.test(boundedText(current.trackId, 100))) {
          return ctx.badRequest('Episode publication requires a valid permanent Track ID.');
        }
        const result = await documents(model.uid).publish({ documentId, populate: editorialPopulate(model) });
        const published = result.entries?.[0] || current;
        const revisionNumber = await recordAction(entityType, model, documentId, published, action, actor, input.note);
        if (entityType === 'episode') {
          await enqueueEpisodeProcessing(documentId, published, revisionNumber, actor);
        }
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
        const archived = await documents(model.uid).update({ documentId, data, status: 'draft', populate: editorialPopulate(model) });
        if (model.publishable) {
          await documents(model.uid).unpublish({ documentId, populate: editorialPopulate(model) });
        }
        await recordAction(entityType, model, documentId, archived, action, actor, input.note);
        ctx.body = { data: archived };
        return;
      }

      if (action === 'restore') {
        const data: Record<string, unknown> = { archivedAt: null, archiveReason: null };
        if (contentTypeAttributes(model.uid).active) {
          data.active = true;
        }
        const restored = await documents(model.uid).update({ documentId, data, status: 'draft', populate: editorialPopulate(model) });
        await recordAction(entityType, model, documentId, restored, action, actor, input.note);
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
