import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::editorial-event.editorial-event', () => ({
  async update(ctx) {
    return ctx.forbidden('Editorial audit events are immutable.');
  },
  async delete(ctx) {
    return ctx.forbidden('Editorial audit events are immutable.');
  },
}));
