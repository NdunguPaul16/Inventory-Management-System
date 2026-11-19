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
compiled `reconcile:stock` job is tested against an in-memory replica set for a
clean ledger, a one-cent difference and missing database configuration. Local
results do not establish deployed behavior or representative-volume performance.

## Prerequisites for staging acceptance

1. Review the local item and location management prerequisite before staging.
   It provides permission-gated create, list, search, edit and status routes,
   matching screens, and transactional audit records. Stocked identities cannot
   be changed or deactivated. The first inbound posting serializes with an
   overlapping identity or status edit. Confirm the seeded role permissions
   after rollout and create only disposable staging master data with separate
   approval. The broader Phase 1 item fields, categories and unit conversions
   remain pending.
2. Preserve the decided stock approval policy: every adjustment and count
   variance needs a **different Manager or Admin** approver, regardless of
   amount. No stock-specific threshold changes approval authority. The broader
   Phase 1 settings module is still pending for other business settings.
3. Confirm a dedicated staging MongoDB replica set, database name and least
   privilege account. Keep credentials out of commands, logs and source control.
4. Review the local Mongoose `9.11.4` dependency commit before integration.
   Local installation and tests do not establish the deployed dependency version.
5. Define representative item/location, layer and movement volumes and an
   acceptable completion time before testing. These values must come from the
   expected operation, not a guessed test fixture.
6. Review the local stock-balance cursor pagination and server-side search with
   representative data before staging acceptance. The balances page requests
   one page at a time; item detail loads additional locations on demand.

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
