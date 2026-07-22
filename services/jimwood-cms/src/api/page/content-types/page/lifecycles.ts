import { errors } from '@strapi/utils';

const { ValidationError } = errors;
const pageUid = 'api::page.page';

type LifecycleEvent = {
  params: {
    data?: Record<string, unknown>;
    where?: Record<string, unknown>;
  };
};

async function assertImmutablePageKey(event: LifecycleEvent) {
  const data = event.params.data;
  if (!data || !Object.prototype.hasOwnProperty.call(data, 'pageKey') || !event.params.where) {
    return;
  }

  const requestedPageKey = data.pageKey;

  const existing = await strapi.db.query(pageUid).findOne({
    where: event.params.where,
    select: ['pageKey'],
  });
  if (existing?.pageKey !== undefined && existing.pageKey !== requestedPageKey) {
    throw new ValidationError('Page identity cannot be changed after creation.');
  }
}

const lifecycles = {
  async beforeUpdate(event: LifecycleEvent) {
    await assertImmutablePageKey(event);
  },
};

export default lifecycles;
