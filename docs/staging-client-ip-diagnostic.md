# Temporary staging client-IP diagnostic

This diagnostic is for a short, separately approved staging validation only. It
does not change authentication, rate limits, or Express proxy trust. Do not merge
it into a production release. The current local patch has not been deployed.

## Manual Render settings to verify before any deployment

The actual manually configured service is `inventory-inc-staging-backend`.
`render.yaml` describes a different Blueprint service and does not update this
manual service. In the Render dashboard, record and compare these settings
without copying secret values into a report:

| Setting | Required diagnostic deployment value |
| --- | --- |
| Service ID and name | Confirm the existing staging service ID and `inventory-inc-staging-backend`; do not select the production service |
| Git branch | `staging/security-audit` at the separately approved commit |
| Root directory | Repository root |
| Build Command | `npm ci --include=dev && npm run build:shared && npm run build:staging -w backend` |
| Start Command | `npm run start:staging -w backend` |
| Auto-Deploy | Off |
| Database | `MONGODB_DB_NAME=ims_staging`; masked `MONGODB_URI` and `STAGING_ATLAS_HOST` identify the staging Atlas cluster, distinct from `PRODUCTION_ATLAS_HOST` |
| Key Value | Masked `AUTH_RATE_LIMIT_REDIS_URL` and `STAGING_KEY_VALUE_HOST` identify the separate staging instance |
| Authentication and browser origin | Staging-only `AUTH_ACCESS_TOKEN_SECRET`, `AUTH_REFRESH_TOKEN_SECRET`, and the protected Preview origin in `CORS_ORIGINS`; keep `AUTH_TRUSTED_PROXY_CIDRS` at its existing value |

The build installs workspace dependencies, compiles `shared/`, and then compiles
the staging backend into `dist-staging/`. The start script executes
`dist-staging/cli/check-staging-env.js` before the API entry point. Confirm the
startup log says `Staging isolation check passed` and identifies
`dbName: ims_staging`, without printing connection strings. Do not infer these
dashboard settings from the Blueprint file or a successful health response.

## Staging release record — complete before deployment

The verified pre-diagnostic Git baseline is
`2f469c5c2fc0a209859db475b413f6df9c60c97b`. The staging service is
reported Live at that commit, but its actual deployed SHA and service ID still
require manual Render dashboard confirmation. Keep the diagnostic release
record pending until its new commit is pushed and GitHub Actions succeeds.
Do not use the baseline SHA as the new diagnostic commit.

| Evidence | Release value |
| --- | --- |
| New diagnostic commit SHA on `staging/security-audit` | **Pending — record the full SHA after the reviewed commit** |
| GitHub Actions run and conclusion for that exact SHA | **Pending — record the run URL and successful result** |
| Existing Render service ID and name | **Pending dashboard verification**; name must be `inventory-inc-staging-backend`, never the production service |
| Previously deployed, known-good staging SHA | **Reported:** `2f469c5c2fc0a209859db475b413f6df9c60c97b`; **pending dashboard confirmation** against this staging service's deployment history |
| Previous Build and Start Commands | **Pending — copy from this staging service's current Settings** |
| Git branch, root directory, and Auto-Deploy | **Pending dashboard verification**; require `staging/security-audit`, repository root, and Off |
| Database and Key Value identity | **Pending dashboard verification** of `ims_staging`, the separate staging Atlas cluster, and staging Key Value instance; record identities, not secrets |
| Diagnostic flag and expiry | Flag must remain `false` or absent through deployment; expiry absent until a separately authorized test window |

All pending fields are deployment gates. Local tests do not substitute for the
GitHub Actions result or the actual service settings. Record the exact full SHA
and CI run before coordinating the Render command change. Keep Vercel Preview
protection and automatic deployment suppression unchanged. The currently
configured Render Build Command must remain unchanged until the separately
authorized staging deployment window.

### Coordinated staging deployment proposal — separate approval required

1. In the actual staging service, record the currently deployed SHA, Build
   Command, Start Command, service ID, branch, root, and Auto-Deploy setting.
   Confirm the diagnostic flag is disabled and the staging Atlas and Key Value
   identities match the pinned hosts. Record no credentials or URLs containing
   them.
2. After the diagnostic commit passes GitHub Actions, schedule one staging-only
   change window. Change the Build Command to
   `npm ci --include=dev && npm run build:shared && npm run build:staging -w backend`
   and keep the Start Command at `npm run start:staging -w backend`. Deploy the
   **same recorded commit SHA** manually. A settings save may initiate a deploy;
   watch its status and do not leave the new command paired with the old commit
   or the old command paired with the new commit.
3. Verify the deployed SHA, `Staging isolation check passed`, `dbName:
   ims_staging`, Key Value health, and the usual `/api/v1/health` response. With
   the flag disabled, the diagnostic endpoint must return a generic `404`.
   Do not enable the diagnostic as part of this deployment.
4. Only after separate authorization for a short test window, set an absolute
   UTC expiry about 30 minutes ahead (and never more than 24 hours ahead) and
   enable the flag on the staging service. Record the expiry and authorization.
   Disable the flag immediately after measurement and confirm `404` again.

If the build, preflight, health check, or disabled-route check fails, stop the
test. Restore the **previous Build Command and previous known-good staging
commit together** through a manual staging deployment; restore the previous
Start Command too if it differed. The pre-diagnostic script in `2f469c5` starts
from `dist/`, whereas the diagnostic script starts from `dist-staging/`, so a
command-only rollback can leave incompatible code and output. Confirm the
restored deployment SHA, isolation log, and health response before resuming
staging work. Do not change production or rerun administrator bootstrap.

## Build boundary

The normal backend build (`npm run build -w backend`) excludes
`backend/src/staging/` and emits `backend/dist/index.js`, whose startup path does
not mount the diagnostic. The ordinary `npm start -w backend` command also uses
that entry point and retains the staging isolation preflight. The staging build
(`npm run build:staging -w backend`)
emits `backend/dist-staging/staging/index.js` and mounts the diagnostic before
the normal request logger. The staging Render build and start commands select
only that separate output. Tests inspect the TypeScript build inputs and verify
that the normal app has no diagnostic route even with misleading staging-labelled
environment values. Both builds clear only their own generated output directory
first, so old diagnostic JavaScript cannot remain in a later normal build.

This boundary applies to these build commands and entry points. It does not
attest to the Render service identity, prevent someone from deliberately
deploying the staging build as production, or protect an unrelated packaging
process that copies staging source or output. `RENDER_SERVICE_ID`, branch names,
and the staging host variables are configuration assertions, not cryptographic
proof. Before any release, review the actual service, branch, build command,
start command, and artifact contents. Never deploy the staging entry point to
production. The production `dfstock` branch and deployment are unchanged.

## Activation and access

`GET /api/v1/internal/client-ip-diagnostic` returns a generic `404` unless both
conditions hold:

1. `STAGING_CLIENT_IP_DIAGNOSTIC_ENABLED=true` and
   `STAGING_CLIENT_IP_DIAGNOSTIC_EXPIRES_AT` is an absolute UTC ISO timestamp
   within 24 hours of process startup and still in the future.
2. The existing `assertStagingIsolation` guard confirms production runtime mode,
   database `ims_staging`, pinned staging Atlas and Key Value hosts, and a distinct
   production Atlas host.

When active, a valid access token for an active user with the system Admin role
and wildcard permission is required. Anonymous callers receive `401`; other
roles receive `403`. Other methods and paths receive `404`. All responses use
`Cache-Control: no-store, private`. The route has private, quiet request logging
so complete headers and forwarded address strings are not logged by pino-http.
Request IDs are generated by the server; caller-supplied IDs are ignored. The
diagnostic's private error handler logs only a fixed code and status, and
returns a generic response for unexpected failures. It does not forward response
or socket-cleanup failures into the normal full-error logger.

## Output and limits

The response contains temporary keyed identifiers for the socket peer and
Express-selected `req.ip`, their equality, the proxy trust mode, and a bounded
count/status of `X-Forwarded-For` hops. It does not expose raw IPs, complete
headers, credentials, Redis keys, a database hostname, or a claim that a request
came from Vercel. Header contents are not proof of origin.

The HMAC key is random per application process and never persisted or returned.
Matching identifiers can be compared only within one process run and before the
absolute expiry; restarts create new identifiers. The endpoint performs only the
normal read-only access-token validation and has no login-limiter, Redis, or
audit-write path. Render can run more than one process, so identifiers from
different instances are intentionally not comparable.

## Future staging validation (requires separate approval)

1. Record the staging commit, prior Render settings, expiry, and protected
   Preview URL. Keep the feature flag off until the approved test window.
2. Enable the flag with a short UTC expiry on the staging Render service only.
   Confirm the existing Atlas and Key Value isolation pins before deployment.
3. With a few controlled GET requests, compare responses from two unrelated
   client networks through the Vercel rewrite and through the direct Render URL.
   Use pre-established staging administrator sessions and avoid login attempts
   during measurement. Never copy bearer tokens, cookies, or full request
   headers into a report.
4. Confirm whether the selected Express identifier differs across networks and
   whether the socket identifier remains shared. Compare hop counts, but do not
   infer trusted origin from a forwarded header. Follow with separately approved
   spoof-resistance tests before changing any trusted proxy CIDRs.
5. Disable the flag after the bounded test and confirm `404` responses. Let the
   fixed expiry end access even if the flag is left set.

## Removal and rollback

If deployed later, first set `STAGING_CLIENT_IP_DIAGNOSTIC_ENABLED=false` on the
staging service and redeploy the last verified staging commit. Confirm the route
returns a generic `404`. Remove the diagnostic expiry setting after the feature
is disabled. A fixed expiry also ends access if the flag is accidentally left
enabled. Do not clear Redis counters; their existing time-to-live handles
expiration.

Commit `2f469c5` establishes the exact pre-diagnostic configuration. To remove
the temporary code before production promotion, remove `backend/src/staging/`,
`backend/tsconfig.staging.json`, the early-route option in `backend/src/app.ts`,
the staging callback and shared `backend/src/server.ts` extraction (restore the
original startup body in `backend/src/index.ts`), both diagnostic environment
fields in `backend/src/config/env.ts`, the diagnostic tests and build-artifact
test script, this document, and the diagnostic-only export of `canonicalIp` in
`backend/src/modules/auth/rate-limit.ts`. Remove the `dist-staging/` ignore and
ESLint rules and the temporary output-cleaning script. Restore the original
`backend/tsconfig.build.json` include behavior once the staging source is gone.
Review each removal against `2f469c5`; do not reset the working tree or revert
unrelated authentication, rate-limiting, audit, or inventory changes.

Restore these exact commands from `2f469c5` for the staging service:

```text
Build Command: npm ci --include=dev && npm run build:shared && npm run build -w backend
Start Command: npm run start:staging -w backend
```

In `backend/package.json`, restore `build` to `tsc -p tsconfig.build.json`,
`start` to `npm run start:staging`, and `start:staging` to
`node dist/cli/check-staging-env.js && node dist/index.js`; remove
`build:staging` and `test:build-artifacts`. The Start Command stays the same,
but its restored script selects `dist/`. Update `render.yaml` and the staging
documentation to match. After a fresh normal build, verify there is no
`backend/dist/staging/` directory or diagnostic import, and verify the start
script still runs `dist/cli/check-staging-env.js` before `dist/index.js`.
Run formatting, lint, typechecking, both applicable builds, and tests before
reviewing a production candidate. No change to `AUTH_TRUSTED_PROXY_CIDRS` or
the login thresholds is part of this patch.
