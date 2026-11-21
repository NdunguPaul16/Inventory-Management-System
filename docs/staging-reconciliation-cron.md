# Staging nightly stock reconciliation: prepared, not activated

The existing read-only snapshot comparison runs at 23:00 UTC (02:00 East Africa
Time) after a separate Mongo-only isolation preflight. The staging command is
`npm run reconcile:stock:staging -w backend`. It requires `NODE_ENV=production`,
`MONGODB_DB_NAME=ims_staging`, `MONGODB_URI` pointing to the pinned staging Atlas
SRV hostname, and distinct `STAGING_ATLAS_HOST` and `PRODUCTION_ATLAS_HOST`.
The URI path must be empty or `ims_staging`. The Cron needs a staging-only Atlas
user with the permissions required for snapshot reads. It does not need the
web service's Valkey URL or authentication secrets. The web preflight is unchanged.

## Proposed Render configuration

This is a review-only example. **Do not add it to the active `render.yaml` or
sync a Blueprint until the service and costs are separately approved.**

```yaml
services:
  - type: cron
    name: inventory-inc-staging-stock-reconciliation
    runtime: node
    branch: staging/security-audit # only after the reviewed commit is released there
    autoDeployTrigger: off
    plan: 1c-2g # provisional; verify memory with representative staging volume
    schedule: '0 23 * * *' # UTC
    buildCommand: npm ci --include=dev && npm run build:shared && npm run build:staging -w backend
    startCommand: npm run reconcile:stock:staging -w backend
    envVars:
      - key: NODE_ENV
        value: production
      - key: MONGODB_DB_NAME
        value: ims_staging
      - key: MONGODB_URI
        sync: false
      - key: STAGING_ATLAS_HOST
        sync: false
      - key: PRODUCTION_ATLAS_HOST
        sync: false
      - key: RECONCILE_EMAIL_API_KEY
        sync: false
      - key: RECONCILE_EMAIL_FROM
        sync: false
      - key: RECONCILE_EMAIL_TO
        sync: false
```

`RECONCILE_EMAIL_API_KEY` is a server-only key for the Resend email API;
`RECONCILE_EMAIL_FROM` must be a verified sender, and `RECONCILE_EMAIL_TO` is a
comma-separated list of designated system administrators. Do not put these in
Git, frontend variables, CLI arguments or logs. The provider adapter uses one
HTTPS request with a ten-second timeout and no retry. A required email failure
makes the job exit `1`; it does not reveal the provider response or credentials.
The sender and recipient domain, billing, account permissions, and delivered
email remain to be approved and verified.

Exit `0` means clean, `2` means discrepancies, and `1` means configuration,
execution, 30-minute critical duration, or required notification failure. A
warning email is queued at 15 minutes and a failure email at 30 minutes while
the process remains alive. No branch repairs or writes inventory. Render's
single-run guarantee prevents overlapping executions of this Cron service.
Enable Render's service failure notifications to an independent operator
channel; an in-process email cannot report a killed process or missing run.

## Independent watchdog design (not deployed)

An independent scheduler must read durable Render run metadata and its own
previous alert state. The pure `watchdogOutcome` decision function is locally
tested: no start or unfinished work after 15 minutes produces a warning; after
30 minutes it produces a failure; a later clean completion after an alert
produces a recovery. The monitor must send these events through the same
notifier, avoid duplicate alerts, and retain alert state outside the Cron
process. No independent scheduler, metadata reader, or durable state is
configured yet. Consequently missing-run, killed-process and recovery email
delivery are **not operationally verified**.

Before activation, run one controlled staging job with disposable data,
confirm the clean, discrepancy, failure and warning exits and actual email
delivery, and test the independent watchdog's missing-run and recovery paths.
Record actual elapsed time and peak memory against the 15-minute target and
30-minute critical threshold. Do not create artificial drift in historical or
production records. Verify the Atlas user cannot write stock.

If the schedule or notifications misbehave, turn off only the staging Cron
schedule, keep the staging web service unchanged, and use the protected manual
reconciliation endpoint for investigation. Restore the previous known-good
Cron commit and environment only after checking the database and email target;
no automatic stock repair is permitted. Production scheduling is separate.
