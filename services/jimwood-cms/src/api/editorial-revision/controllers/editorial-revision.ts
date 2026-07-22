import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::editorial-revision.editorial-revision', () => ({
  async update(ctx) {
    return ctx.forbidden('Editorial revisions are immutable.');
  },
  async delete(ctx) {
    return ctx.forbidden('Editorial revisions are immutable.');
  },
}));
