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
  attributes: Record<string, { type?: string }>;
};

const entityModels = {
  page: { uid: 'api::page.page', titleField: 'title', publishable: true },
  post: { uid: 'api::post.post', titleField: 'title', publishable: true },
  episode: { uid: 'api::episode.episode', titleField: 'title', publishable: true },
  person: { uid: 'api::person.person', titleField: 'name', publishable: true },
  endorsement: { uid: 'api::endorsement.endorsement', titleField: 'attribution', publishable: true },
  'media-asset': { uid: 'api::media-asset.media-asset', titleField: 'title', publishable: true },
  redirect: { uid: 'api::redirect.redirect', titleField: 'fromPath', publishable: false },
} as const;

type EntityType = keyof typeof entityModels;
type EditorialAction = 'create' | 'save' | 'publish' | 'unpublish' | 'archive' | 'restore' | 'rollback' | 'delete' | 'upload';

const revisionUid = 'api::editorial-revision.editorial-revision';
const eventUid = 'api::editorial-event.editorial-event';

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

function withoutSystemFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutSystemFields);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (['id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt', 'locale', 'localizations'].includes(key)) {
      continue;
    }
    result[key] = withoutSystemFields(child);
  }
  return result;
}

function writableSnapshot(uid: string, snapshot: Record<string, unknown>) {
  const attributes = contentTypeAttributes(uid);
  const data: Record<string, unknown> = {};

  for (const [name, attribute] of Object.entries(attributes)) {
    if (!(name in snapshot) || ['relation', 'password'].includes(attribute.type || '')) {
      continue;
    }

    const value = snapshot[name];
    if (attribute.type === 'media') {
      if (Array.isArray(value)) {
        data[name] = value.map((item) =>
          item && typeof item === 'object' && 'id' in item ? (item as { id: unknown }).id : item,
        );
      } else if (value && typeof value === 'object' && 'id' in value) {
        data[name] = (value as { id: unknown }).id;
      } else {
        data[name] = value;
      }
      continue;
    }
    data[name] = withoutSystemFields(value);
  }

  return data;
}

async function findDraft(uid: string, documentId: string) {
  return documents(uid).findOne({
    documentId,
    status: 'draft',
    populate: '*',
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
  const snapshot = withoutSystemFields(document);

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
}

function requestBody(ctx: EditorialContext): WorkflowBody {
  const candidate = ctx.request?.body;
  return candidate && typeof candidate === 'object' ? candidate as WorkflowBody : {};
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

    return withEditorialTransaction(entityType, '', async () => {
      const created = await documents(model.uid).create({
        data: input.data,
        status: 'draft',
        populate: '*',
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

    return withEditorialTransaction(entityType, documentId, async () => {
      if (entityType === 'page') {
        const current = await findDraft(model.uid, documentId);
        if (!current) {
          return ctx.notFound('Content item was not found.');
        }
        const requestedPageKey = input.data?.pageKey;
        if (typeof requestedPageKey === 'string' && requestedPageKey !== current.pageKey) {
          return ctx.badRequest('Page identity cannot be changed after creation.');
        }
        input.data!.pageKey = current.pageKey;
      }

      const updated = await documents(model.uid).update({
        documentId,
        data: input.data,
        status: 'draft',
        populate: '*',
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
    const action = String(ctx.params.action || '') as EditorialAction;
    if (!documentId) {
      return ctx.badRequest('Document id is required.');
    }

    return withEditorialTransaction(entityType, documentId, async () => {
      const current = await findDraft(model.uid, documentId);
      if (!current) {
        return ctx.notFound('Content item was not found.');
      }

      if (action === 'publish') {
        if (!model.publishable) {
          return ctx.badRequest('This content type does not use draft publishing.');
        }
        if (current.archivedAt) {
          return ctx.badRequest('Archived content must be restored before it can be published.');
        }
        const result = await documents(model.uid).publish({ documentId, populate: '*' });
        const published = result.entries?.[0] || current;
        await recordAction(entityType, model, documentId, published, action, actor, input.note);
        ctx.body = { data: published };
        return;
      }

      if (action === 'unpublish') {
        if (!model.publishable) {
          return ctx.badRequest('This content type does not use draft publishing.');
        }
        await documents(model.uid).unpublish({ documentId, populate: '*' });
        const draft = (await findDraft(model.uid, documentId)) || current;
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
        const archived = await documents(model.uid).update({ documentId, data, status: 'draft', populate: '*' });
        if (model.publishable) {
          await documents(model.uid).unpublish({ documentId, populate: '*' });
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
        const restored = await documents(model.uid).update({ documentId, data, status: 'draft', populate: '*' });
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
        const restored = await documents(model.uid).update({ documentId, data, status: 'draft', populate: '*' });
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
