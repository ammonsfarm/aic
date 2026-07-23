import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::redirect.redirect', () => ({
  async create(ctx) {
    return ctx.forbidden('Redirect mutations must use the audited editorial workflow.');
  },
  async update(ctx) {
    return ctx.forbidden('Redirect mutations must use the audited editorial workflow.');
  },
  async delete(ctx) {
    return ctx.forbidden('Redirect mutations must use the audited editorial workflow.');
  },
}));
