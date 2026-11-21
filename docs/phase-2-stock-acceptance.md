# Phase 2 stock acceptance and reconciliation operations

This is a staging checklist for the local Phase 2 implementation. It does not
authorise a deployment, database change, scheduled job or production access.
Use a disposable replica-set database for any volume test; never use production
`ims` for acceptance testing.

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

On 2026-11-20, the stock review branch's
`backend/scripts/benchmark-stock-reconciliation.mjs` created a disposable local
in-memory replica set with the agreed launch baseline: 1,000 SKUs, 5 locations,
5,000 balances, 20,000 FIFO layers and 100,000 historical movements. The
read-only reconciliation checked all 5,000 balances and found zero differences
in two runs (3,934 and 3,857 ms). Peak Node.js process RSS was 467 and 511 MiB,
respectively; this excludes the MongoDB process. The script inserts synthetic
consistent records directly and
measures neither posting throughput nor Atlas/Render performance. Its three
sample page queries examined 50 balance documents, 4 FIFO layer documents and
50 movement documents. This is preliminary local evidence, **not** the
15-minute staging acceptance result or a basis for choosing Cron memory alone.
To repeat it, build the backend, set `MONGOMS_SYSTEM_BINARY` to an already
installed local MongoDB binary and run
`node backend/scripts/benchmark-stock-reconciliation.mjs` from the repository
root. The script creates its own database and does not read a deployed URI.

On 2026-11-21, the synthetic fixture kept those same totals but placed 75
layers at one item/location pair, offset by 71 pairs with three layers. This
exercised a 50-layer first page and a distinct 25-layer second page. SKU search
returned five balances, and location search returned two distinct 50-row pages.
Two local runs reconciled all 5,000 balances with zero differences in 2,405
and 2,259 ms; peak Node.js RSS was 453 and 511 MiB. The FIFO pages used the
`itemId_1_locationId_1_receivedAt_1__id_1` index and examined 50 and 25
documents. The SKU substring lookup scanned all 1,000 item documents, while
its five-balance result used the item/location index. The first location
balance page examined 250 documents using `_id_`. These are local query-plan
and correctness observations, not evidence of Atlas latency, concurrent users
or an approved staging run. Substring item search should be remeasured if the
catalog grows materially beyond the agreed 1,000-SKU baseline.

The separate `backend/scripts/verify-reconciliation-read-role.mjs` check passed
locally on 2026-11-20: an authenticated in-memory MongoDB user with only
`read@ims_staging` ran the compiled reconciliation job and was denied a stock
write. This establishes a feasible least-privilege database role for the job;
actual staging Atlas privileges and host isolation still need verification.

## Branch and deployment boundary

`phase-2/stock-counts` descends directly from `dfstock` and is the stock-code
review branch. Its `frontend/vercel.json` disables automatic Git deployments for
that exact branch so a push for CI cannot create a Preview that routes to the
production backend. Confirm both connected Vercel projects still use `frontend`
as their Root Directory and verify no Preview was created after any approved
push. This checked-in rule does not suppress other branch names.

The separate local `integration/phase-2-security` branch combines Phase 2 with
staging-only authentication and a staging API rewrite for compatibility tests.
It must **not** be merged wholesale into `dfstock`. Stage Phase 2 by reviewing
its merge into `staging/security-audit` only after the signed-login gateway's
backend-first rollout and rollback controls are approved. Promote stock code to
`dfstock` from the stock review branch after staging acceptance, CI and a
separately approved production release sequence.

## Prerequisites for staging acceptance

1. Review the local item and location management prerequisite before staging.
   It provides permission-gated create, list, search, edit and status routes,
   matching screens, and transactional audit records. Stocked identities cannot
   be changed or deactivated. The first inbound posting serializes with an
   overlapping identity or status edit. Confirm the seeded role permissions
   after rollout and create only disposable staging master data with separate
   approval. Item-level conversion definitions and replenishment fields are
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
5. Use the agreed launch baseline of 1,000 SKUs, 5 locations, 20,000 FIFO
   layers and 100,000 historical movements, with a 15-minute maximum for
   nightly reconciliation. Record actual staging results before acceptance.
6. Review the local stock-balance cursor pagination and server-side search with
   representative data before staging acceptance. The balances page requests
   one page at a time and resolves an exact location-code filter independently
   of the current page; item detail loads additional locations on demand from
   its stock and FIFO tabs.
7. Review FIFO layer pagination with representative data. The item detail page
   requests 50 layers at a time in receipt order, using the last layer ID as its
   cursor; staging performance and completeness remain unverified.

## Stock workflow acceptance

In staging, use disposable items, locations and users. Record request IDs and
HTTP statuses without recording credentials. Test Admin, Manager and
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
  sequence, and detects a deliberately introduced discrepancy in a **disposable**
  database. Do not alter historical or production records to create drift.

## Nightly reconciliation gate

The built backend exposes `npm run reconcile:stock -w backend`. It requires an
explicit `MONGODB_URI` and `MONGODB_DB_NAME`; its source is
`backend/src/jobs/reconcile-stock.ts`. Run it from the repository root with an
environment scoped to the intended database. A scheduler must invoke the
command nightly and alert an operator on **either** nonzero exit:

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

On the disposable staging database, create the agreed volume through approved
posting APIs, then run the reconciliation command while other posting traffic
is controlled. Record item/location count, movement count, elapsed time, peak
resource use, exit code and differences. Verify a single committed snapshot is
used so concurrent postings do not cause false drift. Do not use these data or
measurements as a reason to change production capacity without review.

Phase 2 release remains pending until the master-data prerequisite is reviewed
and integrated, staging workflow checks, scheduled alert delivery and the
representative-volume result are recorded. Passing local tests alone is not a
release decision.
