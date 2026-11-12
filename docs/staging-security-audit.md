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
The branch-specific `git.deploymentEnabled` setting in `frontend/vercel.json` also
suppresses Vercel's automatic preview deployment on that push. Verify the Vercel
project has not overridden this setting in its dashboard.

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

Both `start` and `start:staging` run `check-staging-env` before opening the API. It refuses to start
unless the URI hostnames match the pinned staging hosts, the Atlas host differs from
the production host, and `MONGODB_DB_NAME` is `ims_staging`. Validation errors omit
connection strings and credentials. The check accepts an Atlas `mongodb+srv://` URI.
The staging branch's `bootstrap:admin` command runs the same preflight, and its CLI
rechecks isolation before it asks for credentials or connects to MongoDB. Use this
command only after verifying the staging service and database identity. A Free Render
web service has neither Shell nor one-off jobs; if that is the selected plan, run the
built CLI locally from this staging branch with staging-only Atlas credentials and the
same pinned variables. Never use a production service environment for this command.

## Read-only isolation and database preflight

The public health response proves the API can ping MongoDB and that its login limiter
store is available. It does not report the database name, confirm role seeding, or
identify the deployed commit. In the **staging** Render dashboard, confirm the service
branch and deployed commit, the `start:staging` command, and these startup log entries:
`Staging isolation check passed` and `MongoDB connected` with `dbName: ims_staging`.
Check that `Identity bootstrap failed` is absent after connection. Compare the masked
environment's `STAGING_ATLAS_HOST`, `PRODUCTION_ATLAS_HOST`, and
`STAGING_KEY_VALUE_HOST` to the separate staging resources in Atlas and Render; the
configured staging and production Atlas hostnames must differ. `render.yaml` describes
a staging Blueprint but does not prove the settings of a manually created service.

For database checks, connect a read-only client **only to the separately identified
staging Atlas cluster**, with a user restricted to `ims_staging`. Confirm the host and
selected database before any query. Do not connect to production or run the bootstrap
as part of this review. These `mongosh` commands do not write data:

```javascript
db.getName() // must be ims_staging
db.roles.find({ isSystem: true }, { _id: 0, name: 1 }).sort({ name: 1 }).toArray()
db.roles.countDocuments({ isSystem: true }) // expect the eight default roles
db.users.countDocuments({}) // if nonzero, bootstrap must refuse
db.audit_logs.getIndexes() // inspect at_-1__id_-1 and its { at: -1, _id: -1 } key
db.runCommand({ connectionStatus: 1, showPrivileges: true }).authInfo
```

The last result verifies only the connected read-only client's privileges. In Atlas
Database Access, separately inspect the database user named in the staging service's
protected URI: it must be scoped to `ims_staging`, with no `ims` or all-database write
privilege. Do not paste credentials or full privilege results into tickets or chat;
report only the scope and whether it passed.
The eight expected role names are Admin, Owner / Manager, Purchasing Officer,
Storekeeper, Workshop Supervisor, Sales Officer, Accountant, and Viewer / Auditor.
If they are missing, inspect the staging startup logs before provisioning an admin.
The application starts with `autoIndex: false` in production runtime, so the index
must be verified explicitly; its presence cannot be inferred from a healthy API.

## Vercel preview routing

The staging branch's `frontend/vercel.json` retains
`git.deploymentEnabled: { "staging/security-audit": false }`, so a Git push must not
automatically create a Preview. It now rewrites `/api/:path*` to the exact staging
Render origin `https://inventory-inc-staging-backend.onrender.com/api/:path*` before
the SPA fallback to `/index.html`. It contains no production backend URL. The
frontend uses same-origin `/api/v1` calls; no frontend API-origin environment value
is needed. These repository changes do not deploy a Preview.

Before a separately approved manual Preview, check the Vercel project has Production
Branch `dfstock`, Root Directory `frontend/`, and **Include source files outside of
the Root Directory in the Build Step** enabled so the root lockfile and `shared/`
workspace are available. Check Settings > Deployment Protection: Vercel
Authentication with Standard Protection (or a stronger existing setting) must cover
Preview URLs, with no bypass or public sharing enabled. Check the project dashboard
for routing rules outside this repository; do not change production settings.

After the reviewed staging commit is pushed, use Vercel Project > Deployments >
Create Deployment and enter the **exact staging commit SHA** as the Git reference.
If Vercel asks which branch configuration to use, choose `staging/security-audit` and
confirm the target is **Preview**, never Production. Inspect the Preview build and
its protection before sharing the URL. Open `/api/v1/health` on the protected Preview
and compare its response with the staging Render endpoint. A Vercel sign-in prompt
for an unauthorised browser confirms Preview protection; the health response behind
it should report the staging API, MongoDB connected, and `authRateLimit: up`.
Once the Preview URL is known, set the staging Render service's `CORS_ORIGINS` to that
exact `https://...vercel.app` origin before browser login tests; any Render config
save/redeploy is a separate approved action. Keep the staging Render backend public
URL in mind: Vercel Preview protection does not itself restrict direct backend access.

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
