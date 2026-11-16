import { Router } from 'express';
import { runServer } from '../server.js';
import { clientIpDiagnosticRouter } from './client-ip-diagnostic.js';
import { createStagingLoginIdentity } from './login-identity.js';

runServer(({ source, logger, auth, rateLimitStore }) => {
  try {
    const identity = createStagingLoginIdentity({ source, store: rateLimitStore });
    const routes = Router();
    routes.use(identity.capture);
    routes.use(
      '/api/v1/internal/client-ip-diagnostic',
      clientIpDiagnosticRouter({ source, logger, auth }),
    );
    return {
      earlyRoutes: routes,
      loginAdmission: identity.admit,
      loginClientIdentity: identity.clientIdentity,
    };
  } catch {
    // Startup failures must not print environment values or thrown diagnostic data.
    throw new Error('Staging ingress initialization failed');
  }
});
