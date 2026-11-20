# Phase 2 stock acceptance and reconciliation operations

This is a staging checklist for the local Phase 2 implementation. It does not
authorise a deployment, database change, scheduled job or production access.
Use a dedicated disposable replica set for deliberate drift injection or bulk
volume loading; never use production `ims`. The operational staging database
`ims_staging` already has users and audit history. Approved smoke-test postings
there remain in its append-only ledger and must not be treated as deletable
temporary records.

## Local evidence

From the repository root, install dependencies and run:

```text
npm ci
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm run test:engine:coverage -w backend
```

The FIFO coverage gate is 90% of engine lines. Automated tests cover concurrent
OUT, idempotency, transaction rollback, fractional transfer/reversal value
conservation, controlled stock actions, serial counts and reconciliation. The
API-level workflow test also carries a fractional approved opening through a
Storekeeper transfer and count, separate Admin approval, posting and a clean
read-only reconciliation in one disposable in-memory replica set. This verifies
the combined route sequence locally; staging acceptance remains separate. The
compiled `reconcile:stock` job is tested against an in-memory replica set for a
clean ledger, a one-cent difference and missing database configuration. Local
results do not establish deployed behavior or representative-volume performance.
An isolated local integration of Phase 2 with the staging security branch passed
347 automated tests (3 shared, 215 backend, 129 frontend), lint, formatting,
typecheck, normal and staging builds, and three build-artifact checks. The
integrated branch separately passed the FIFO engine coverage gate: 91.35% of
lines (391/428), with 90.9% for `service.ts`. The staging reconciliation command
also has a local regression proving that an `ims` database target fails the
isolation preflight before the job connects. The integration branch has not been
pushed or deployed.

On 2026-11-20, `backend/scripts/benchmark-stock-reconciliation.mjs` created a
fresh local in-memory replica set with the launch baseline of 1,000 SKUs,
5 locations, 5,000 balances, 20,000 FIFO layers and 100,000 movements. The
read-only reconciliation checked all 5,000 balances and found zero differences
in each of two runs (3,847 and 4,070 ms); peak Node.js process RSS was 470 and
520 MiB, respectively. The benchmark directly
inserts synthetic consistent records, requires a preinstalled local MongoDB
binary and never reads a deployed URI. It does not measure posting API throughput,
the MongoDB process's memory, Atlas/Render performance or nightly scheduling.
For its sample page queries, MongoDB examined 50 balance documents, 4 FIFO
layers and 50 movement documents; filtered search at scale remains unmeasured.
It is preliminary local evidence, **not** the 15-minute staging acceptance result.
To repeat the probe, build the backend, set `MONGOMS_SYSTEM_BINARY` to an
already installed local MongoDB binary, then run
`node backend/scripts/benchmark-stock-reconciliation.mjs` from the repository
root. The script creates its own in-memory database and ignores deployed URI
settings.

## Branch and deployment boundary

`integration/phase-2-security` combines the stock review branch with temporary
staging login-gateway code and a staging API rewrite. It is a staging validation
candidate, **not** a production merge source. Promote stock changes to `dfstock`
from `phase-2/stock-counts` after staging acceptance and a separate production
review. The integration branch's `frontend/vercel.json` disables automatic Git
deployments for both its own exact branch name and `staging/security-audit`; it
does not disable other branches. Before any approved push, confirm the connected
Vercel projects still use `frontend` as Root Directory and that the applicable
branch rule prevents an automatic Preview. A manual protected Preview and the
backend-first gateway release need separate authorization and coordination.

## Prerequisites for staging acceptance

1. Review the local item and location management prerequisite before staging.
   It provides permission-gated create, list, search, edit and status routes,
   matching screens, and transactional audit records. Stocked identities cannot
   be changed or deactivated. The first inbound posting serializes with an
   overlapping identity or status edit. Confirm the seeded role permissions
   after rollout and create uniquely named staging test master data only with
   separate approval. Record its identifiers and retention plan. Item-level
   conversion definitions and replenishment fields are
   available locally, but posting still requires base-unit quantities. The
   broader Phase 1 item fields, categories and unit catalog remain pending.
2. Preserve the decided stock approval policy: every adjustment and count
   variance needs a **different Manager or Admin** approver, regardless of
   amount. No stock-specific threshold changes approval authority. The broader
   Phase 1 settings module is still pending for other business settings.
3. Confirm a dedicated staging MongoDB replica set, database name and least
   privilege account. Keep credentials out of commands, logs and source control.
4. Review the local Mongoose `9.11.4` dependency commit before integration.
   Local installation and tests do not establish the deployed dependency version.
5. Use the launch baseline supplied by the project owner: 1,000 active SKUs,
   5 locations, 20,000 FIFO layers and 100,000 historical movements. Nightly
   reconciliation must finish within 15 minutes. These are acceptance targets,
   not a measured result.
6. Review the local stock-balance cursor pagination and server-side search with
   representative data before staging acceptance. The balances page requests
   one page at a time and resolves an exact location-code filter independently
   of the current page; item detail loads additional locations on demand from
   its stock and FIFO tabs.
7. Review FIFO layer pagination with representative data. The item detail page
   requests 50 layers at a time in receipt order, using the last layer ID as its
   cursor; staging performance and completeness remain unverified.

## Stock workflow acceptance

In `ims_staging`, use approved, uniquely named test items and locations and
separate authorised test users. Record request IDs and HTTP statuses without
recording credentials. Retain posted movements and their audit history; do not
delete or manually repair them after the test. Test Admin, Manager and
Storekeeper separately:

- Opening stock import creates FIFO layers only after request, approval and
  posting. A Storekeeper cannot create, approve or post opening stock.
- An adjustment request cannot be approved by its requester. A separate
  authorised user approves and posts it; a rejected request cannot post.
- Transfer preserves source FIFO dates and total recorded cents across
  locations. Reversal carries the original recorded cost.
- A count freezes the book snapshot, accepts quantity or serial entry, needs
  separate approval, and posts a variance through FIFO. A concurrent stock
  change invalidates the frozen count without partial posting.
- A restricted user receives `403` from protected API routes, including
  reconciliation, regardless of frontend navigation. A custom role granted an
  approval permission is still denied stock approval, rejection and posting.
- A read-only reconciliation finds zero differences after the approved
  sequence. Inject a discrepancy only in a **separate disposable replica set**
  and verify that reconciliation reports it without repair. Do not alter
  operational `ims_staging`, historical or production records to create drift.

## Nightly reconciliation gate

The built backend exposes `npm run reconcile:stock -w backend` for local or
separately approved production operation. For staging, build with
`npm run build:staging -w backend` and use
`npm run reconcile:stock:staging -w backend`. The staging command runs the
same database, Atlas-host and Key Value-host isolation preflight as the staging
service **before** connecting to MongoDB. Both commands require an explicit
`MONGODB_URI` and `MONGODB_DB_NAME`; the job source is
`backend/src/jobs/reconcile-stock.ts`. Run from the repository root with an
environment scoped to the intended database. A scheduler must invoke the
staging command nightly and alert an operator on **either** nonzero exit:

| Exit | Meaning | Operator action |
|---|---|---|
| `0` | Snapshot comparison found no differences | Retain a timestamped success record |
| `1` | Configuration, connection or job failure | Investigate the job; do not assume stock is reconciled |
| `2` | One or more balance differences | Review the permission-gated reconciliation details; do not auto-repair |

Before enabling a schedule, verify the scheduler's database identity, secret
handling, run overlap policy, timeout and alert destination in staging. Test
all three exit paths and a delivered alert without exposing connection data.
If the scheduled job causes an issue, disable **only that staging schedule** and
use the existing manual reconciliation endpoint while investigating. The job
does not repair stock. Production scheduling requires separate approval.

## Representative-volume acceptance

On a dedicated disposable staging-equivalent replica set, create the agreed
volume through approved posting APIs, then run reconciliation while other
posting traffic is controlled. Record item/location, layer and movement counts,
elapsed time, peak resource use, exit code, differences and query-plan evidence
for balance and FIFO-layer pages. Verify a single committed snapshot is used so
concurrent postings do not cause false drift. Compare the test environment's
capacity with operational staging before treating its timing as staging
evidence; if they differ, a separately approved bounded staging measurement is
still required. The `reconcile:stock:staging` command is intentionally pinned to
`ims_staging`; a separate disposable database must use `reconcile:stock` with
its own least-privilege credentials and an operator-verified host and database
name. Do not use these measurements to change production capacity without
review.

Phase 2 release remains pending until the master-data prerequisite is reviewed
and integrated, staging workflow checks, scheduled alert delivery and the
representative-volume result are recorded. Passing local tests alone is not a
release decision.
