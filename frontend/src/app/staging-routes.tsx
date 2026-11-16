import type { RouteObject } from 'react-router';
import { ClientIpDiagnosticPage } from '../modules/staging-diagnostic/ClientIpDiagnosticPage';

export const stagingRoutes: RouteObject[] = [
  { path: '/internal/client-ip-diagnostic', element: <ClientIpDiagnosticPage /> },
];
