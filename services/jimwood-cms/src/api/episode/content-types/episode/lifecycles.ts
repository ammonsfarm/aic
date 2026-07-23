import { errors } from '@strapi/utils';

const { ValidationError } = errors;
const episodeUid = 'api::episode.episode';
const processingRequestUid = 'api::episode-processing-request.episode-processing-request';
const editorialRevisionUid = 'api::editorial-revision.editorial-revision';

type LifecycleEvent = {
  params: {
    data?: Record<string, unknown>;
    where?: Record<string, unknown>;
  };
};

async function rejectPublishedTrackIdChange(event: LifecycleEvent) {
  const data = event.params.data;
  if (!data || !Object.prototype.hasOwnProperty.call(data, 'trackId') || !event.params.where) {
    return;
  }
  const existing = await strapi.db.query(episodeUid).findOne({
    where: event.params.where,
    select: ['trackId', 'documentId', 'sourceFingerprint'],
  });
  if (!existing || existing.trackId === data.trackId || !existing.documentId) {
    return;
  }
  const published = await strapi.db.query(episodeUid).findOne({
    where: { documentId: existing.documentId, publishedAt: { $notNull: true } },
    select: ['id'],
  });
  const processed = await strapi.db.query(processingRequestUid).findOne({
    where: { episodeDocumentId: existing.documentId },
    select: ['id'],
  });
  const publicationRevision = await strapi.db.query(editorialRevisionUid).findOne({
    where: {
      entityType: 'episode',
      entityDocumentId: existing.documentId,
      action: 'publish',
    },
    select: ['id'],
  });
  if (published || processed || publicationRevision || existing.sourceFingerprint) {
    throw new ValidationError('Track ID cannot change after an episode has been published.');
  }
}

export default {
  beforeUpdate: rejectPublishedTrackIdChange,
};
