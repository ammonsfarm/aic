export default {
  routes: [
    {
      method: 'POST',
      path: '/editorial/:entityType',
      handler: 'editorial-workflow.create',
    },
    {
      method: 'PUT',
      path: '/editorial/:entityType/:documentId',
      handler: 'editorial-workflow.update',
    },
    {
      method: 'POST',
      path: '/editorial/:entityType/:documentId/:action',
      handler: 'editorial-workflow.transition',
    },
    {
      method: 'GET',
      path: '/editorial/:entityType/:documentId/revisions',
      handler: 'editorial-workflow.revisions',
    },
  ],
};
