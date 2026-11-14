import { Router } from 'express';
import { runServer } from '../server.js';
import { clientIpDiagnosticRouter } from './client-ip-diagnostic.js';

runServer(({ source, logger, auth }) => {
  try {
    const routes = Router();
    routes.use(
      '/api/v1/internal/client-ip-diagnostic',
      clientIpDiagnosticRouter({ source, logger, auth }),
    );
    return routes;
  } catch {
    // Startup failures must not print environment values or thrown diagnostic data.
    throw new Error('Staging diagnostic initialization failed');
  }
});
