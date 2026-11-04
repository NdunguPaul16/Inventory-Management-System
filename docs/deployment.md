# Deployment preparation

These files prepare separate deployments. No service is deployed by this repository change.

## Render backend

Create a Render Blueprint from the repository root using `render.yaml`. Keep the service root at the repository root so the build can install and compile `shared/` before `backend/`. The Blueprint disables automatic deployments. It builds the backend workspace and starts its existing `dist/index.js` entry point through `npm run start -w backend`.

Supply `MONGODB_URI` for a replica-set MongoDB, unique `AUTH_ACCESS_TOKEN_SECRET` and `AUTH_REFRESH_TOKEN_SECRET` values of at least 32 characters, and `CORS_ORIGINS` with the Vercel frontend origin. The Blueprint requests these values at creation time; do not commit them. Set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` only if a first administrator is needed, then remove them. The existing `/api/v1/health` endpoint is the service health check.

## Vercel frontend

Create a Vercel project from the same repository, set its Root Directory to `frontend/`, and enable **Include source files outside of the Root Directory in the Build Step** so `shared/` and the root lockfile are available. `frontend/vercel.mjs` installs the root npm workspaces, builds `shared/` and the frontend, and publishes `frontend/dist/`.

Set `RENDER_API_ORIGIN` in the Vercel project to the Render HTTPS origin, with no trailing slash or `/api` suffix, for example `https://example.onrender.com`. The first rewrite proxies `/api/*` to that origin while preserving the browser's same-origin API path and refresh cookie. The second rewrite serves `index.html` for frontend routes. The existing local Vite proxy still targets `http://localhost:4000` by default.

After both services are configured, check `/api/v1/health` through the Vercel URL, then check login, refresh and a direct visit to a frontend route. Production authentication requires the same browser origin for the proxied API path. Provider builds and deployed behavior remain unverified until an actual Vercel and Render setup is reviewed.
