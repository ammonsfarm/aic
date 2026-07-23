import { factories, type Core } from '@strapi/strapi';

const requestUid = 'api::episode-processing-request.episode-processing-request';

type DocumentRecord = Record<string, unknown>;
type DocumentService = {
  findOne(params: Record<string, unknown>): Promise<DocumentRecord | null>;
  findMany(params: Record<string, unknown>): Promise<DocumentRecord[]>;
  update(params: Record<string, unknown>): Promise<DocumentRecord>;
};

type WorkerTransitionInput = {
  requestKey: string;
  episodeDocumentId: string;
  workerId: string;
  status: 'queued' | 'failed' | 'completed';
  nextAttemptAt?: string;
  lastError?: string;
  result?: Record<string, unknown>;
  completedAt?: string;
};

function documents(strapi: Core.Strapi) {
  return strapi.documents(requestUid as never) as unknown as DocumentService;
}

function exactText(value: unknown, maximum: number) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : '';
}

function exactDate(value: unknown) {
  const normalized = exactText(value, 80);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : '';
}

function transitionInput(value: unknown): WorkerTransitionInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const requestKey = exactText(input.requestKey, 500);
  const episodeDocumentId = exactText(input.episodeDocumentId, 200);
  const workerId = exactText(input.workerId, 300);
  const statusValue = String(input.status);
  if (!requestKey || !episodeDocumentId || !workerId || !['queued', 'failed', 'completed'].includes(statusValue)) {
    return null;
  }
  const status = statusValue as WorkerTransitionInput['status'];

  if (status === 'completed') {
    const completedAt = exactDate(input.completedAt);
    const result = input.result;
    if (!completedAt || !result || typeof result !== 'object' || Array.isArray(result)) return null;
    return {
      requestKey,
      episodeDocumentId,
      workerId,
      status,
      completedAt,
      result: result as Record<string, unknown>,
    };
  }

  const nextAttemptAt = exactDate(input.nextAttemptAt);
  const lastError = exactText(input.lastError, 4_000);
  if (!nextAttemptAt || !lastError) return null;
  const completedAt = status === 'failed' ? exactDate(input.completedAt) : '';
  if (status === 'failed' && !completedAt) return null;
  return {
    requestKey,
    episodeDocumentId,
    workerId,
    status,
    nextAttemptAt,
    lastError,
    ...(completedAt ? { completedAt } : {}),
  };
}

export default factories.createCoreController(requestUid, ({ strapi }) => ({
  async workerTransition(ctx) {
    const documentId = exactText(ctx.params.documentId, 200);
    const body = ctx.request.body as { data?: unknown } | undefined;
    const input = transitionInput(body?.data);
    if (!documentId || !input) {
      return ctx.badRequest('A valid conditional worker transition is required.');
    }

    const updated = await strapi.db.transaction(async ({ trx }) => {
      const databaseClient = String(strapi.db.config.connection.client || '');
      if (databaseClient.includes('postgres')) {
        await trx.raw(
          'select pg_advisory_xact_lock(hashtextextended(?, 0))',
          [`pastorwood-editorial:episode:${input.episodeDocumentId}`],
        );
      }

      const service = documents(strapi);
      const current = await service.findOne({ documentId });
      const latest = await service.findMany({
        filters: { episodeDocumentId: input.episodeDocumentId },
        sort: ['revisionNumber:desc', 'createdAt:desc'],
        limit: 1,
      });
      const newest = latest[0];
      const stillOwned =
        current?.status === 'running' &&
        current.workerId === input.workerId &&
        current.requestKey === input.requestKey &&
        current.episodeDocumentId === input.episodeDocumentId &&
        newest?.documentId === documentId &&
        newest.requestKey === input.requestKey;
      if (!stillOwned) return null;

      const data = input.status === 'completed'
        ? {
            status: 'completed',
            claimedAt: null,
            workerId: '',
            lastError: '',
            result: input.result,
            completedAt: input.completedAt,
          }
        : {
            status: input.status,
            nextAttemptAt: input.nextAttemptAt,
            claimedAt: null,
            workerId: '',
            lastError: input.lastError,
            completedAt: input.status === 'failed' ? input.completedAt : null,
          };
      return service.update({ documentId, data });
    });

    if (!updated) {
      return ctx.conflict('The episode processing request is no longer the latest claim owned by this worker.');
    }
    ctx.body = { data: updated };
  },
}));
