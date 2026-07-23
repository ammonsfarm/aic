const workerTransitionRoutes = {
  routes: [
    {
      method: 'POST',
      path: '/episode-processing-requests/:documentId/worker-transition',
      handler: 'episode-processing-request.workerTransition',
    },
  ],
};

export default workerTransitionRoutes;
