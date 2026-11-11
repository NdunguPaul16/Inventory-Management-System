# Security and Audit staging setup

This document applies only to branch `staging/security-audit`. It carries six release-candidate
commits from `security/auth-rate-limit` plus staging-only configuration. Do not merge these
staging-only configuration changes into `dfstock`.

## Before the first deploy

Create a separate Atlas staging cluster/project, a database user limited to staging, and a
separate Render Key Value instance. Confirm their hostnames in the provider dashboards.
Do not reuse the production Atlas URI, database user, or Key Value URL. The staging startup
check pins the expected hostnames and database name; the dashboard review establishes
that those expected hosts actually belong to staging resources.

The branch must be pushed to GitHub before Render's Branch dropdown can list it. A push
alone does not deploy the backend specified by this branch's `render.yaml`, because
`autoDeployTrigger` is `off`. If creating a Render web service manually, set Auto-Deploy
to **Off** in its Settings; the Blueprint file does not configure a manually created
service. Refresh Render's repository/branch selector after the approved push.

## Render service settings

| Setting | Staging value |
| --- | --- |
| Repository | `NdunguPaul16/Inventory-Management-System` |
| Branch | `staging/security-audit` |
| Service name | A new staging name, e.g. `inventory-management-staging-backend` |
| Root directory | Repository root |
| Build command | `npm ci --include=dev && npm run build:shared && npm run build -w backend` |
| Start command | `npm run start:staging -w backend` |
| Health check | `/api/v1/health` |
| Auto-Deploy | Off |

Set these environment variables on the **new staging service only**. Values marked
secret belong in Render's protected environment settings, never in Git or chat.

| Variable | Required value |
| --- | --- |
| `NODE_ENV` | `production`, for secure cookies and production validation |
| `MONGODB_URI` | Secret URI for the separate staging Atlas cluster |
| `MONGODB_DB_NAME` | `ims_staging` |
| `STAGING_ATLAS_HOST` | Hostname of that staging Atlas URI, without scheme or credentials |
| `PRODUCTION_ATLAS_HOST` | Production Atlas hostname for the inequality check; no URI or password |
| `AUTH_ACCESS_TOKEN_SECRET` | Unique staging secret, at least 32 characters |
| `AUTH_REFRESH_TOKEN_SECRET` | Another unique staging secret, at least 32 characters |
| `AUTH_RATE_LIMIT_REDIS_URL` | Secret internal URL of the staging Render Key Value instance |
| `STAGING_KEY_VALUE_HOST` | Hostname of that staging Key Value URL, without scheme or credentials |
| `CORS_ORIGINS` | Exact staging frontend origin; use `https://staging.invalid` until it exists |

Leave `AUTH_TRUSTED_PROXY_CIDRS` unset until the forwarding chain is measured in staging.
Optional `AUTH_LOGIN_LIMIT_PER_IP_MINUTE`, `AUTH_LOGIN_LIMIT_PER_IP_HOUR`, and
`AUTH_LOGIN_LIMIT_PER_ACCOUNT_15_MIN` retain defaults of 10, 60, and 5 unless a
staging test temporarily changes them. Restore the defaults afterward. Do not run
the administrator bootstrap against production Atlas; confirm the isolation check and
database identity first, then create only controlled staging accounts.

`start:staging` runs `check-staging-env` before opening the API. It refuses to start
unless the URI hostnames match the pinned staging hosts, the Atlas host differs from
the production host, and `MONGODB_DB_NAME` is `ims_staging`. Validation errors omit
connection strings and credentials. The check accepts an Atlas `mongodb+srv://` URI.

## Vercel preview routing

The staging branch's `frontend/vercel.json` returns `503` for `/api/*` and contains
no production Render rewrite. This deliberately keeps a Vercel preview from contacting
the production backend while the staging Render URL is unknown. The frontend cannot
complete login through that preview yet. Once the new staging Render URL exists,
replace the `503` route with an external rewrite to **that exact staging URL**, rerun
checks, and inspect the preview's `/api/v1/health` response before any login test.
Check the Vercel project dashboard for any routing rules outside this repository.

## Evidence required before integration

1. Verify the staging Render service points at the separate Atlas project/cluster and
   staging Key Value instance, using dashboard identities and masked environment names.
2. Check staging login, refresh, logout, protected routes, `429` with `Retry-After`,
   spoofed forwarding headers, and a Key Value outage. Use controlled accounts only.
3. Check Audit History access, filters, pagination, historical redaction, and the
   `(at DESC, _id DESC)` index query plan in staging. See
   [the index migration plan](audit-history-index-migration.md).
4. Confirm GitHub Actions passed for the staging branch commit, then review the exact
   diff against `dfstock`. Keep `dfstock` and production deployments unchanged until
   all staging acceptance gates pass.
