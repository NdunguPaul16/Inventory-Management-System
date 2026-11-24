# Phase 2 offline completion and handover — 2026-11-24

This records completed local work and open acceptance gates. It authorises no
deployment, stock write, Cron activation or production promotion.

## Branches and evidence

| Branch | Local HEAD | Purpose |
| --- | --- | --- |
| `integration/phase-2-security` | `45e6ddb466c9ac680fcf50ab185146e05f00bd8d` | Staging integration and volume-test preparation; includes temporary staging security gateway and diagnostic code. |
| `phase-2/stock-counts` | `6f0f360657449a7bd9473eefd9cc252328de7c3b` | Stock-only production review source; dedicated remote CI has not been verified. |
| `dfstock` | `cd3670b88545126f325bf5d436e05c3b218bed2c` | Unchanged production baseline. |

The integration branch's [GitHub CI run](https://github.com/NdunguPaul16/Inventory-Management-System/actions/runs/45206941864)
passed installation, lint, formatting, typecheck, tests and builds at its exact
HEAD: 3 shared, 230 backend and 136 frontend tests (369 total). The focused
offline reconciliation-alert suite passed 12/12 on 2026-11-24. Previously
recorded local evidence includes 7/7 isolated volume-tool tests, FIFO engine
line coverage of 91.35%, and a synthetic 1,000-SKU/5-location/20,000-layer/
100,000-movement in-memory reconciliation with zero differences. The latter is
not a Render/Atlas performance result.

Earlier operator-reported staging evidence covers Admin authentication and
Audit History, plus seven Storekeeper authentication/permission API checks and
account deactivation. It does not establish full live Phase 2 stock workflow,
nightly scheduling, alert delivery or cloud-volume acceptance. Deployment of
the integration HEAD above has not been verified for those workflows.

## Completed offline functionality

- FIFO posting, cost-preserving transfer/reversal, idempotency, concurrency
  guards, balances, valuation, read-only snapshot reconciliation and pagination.
- Permission-gated item/location management, opening import, adjustment and
  count requests, separate Manager/Admin approval for every variance, posting
  and stock screens. The requester cannot approve their own adjustment.
- Staging-only Mongo preflight before connection, exit codes `0` clean, `2`
  discrepancy, `1` execution/configuration/critical-duration/required-email
  failure. The job compares records and never repairs stock.
- Mocked email outcomes for clean, discrepancy, failure, 15-minute warning and
  30-minute critical duration. Mocked watchdog decisions cover missing or
  stalled runs and recovery. No independent watchdog scheduler or durable run
  state exists yet.

## Deferred acceptance — not passed

| Gate | Status and reason |
| --- | --- |
| Disposable Atlas representative-volume run and 15-minute target | **DEFERRED**: paid Atlas/Render test infrastructure is unavailable. The allowlist in `backend/scripts/volume-test/approved-target.json` remains `null`; the test CLIs fail closed. Preserve the tools for later. Default Atlas snapshot-transaction lifetime may end a long run before the business target. |
| Staging Cron, delivered email and 15/30-minute alert behavior | **DEFERRED**: no Cron service, email credentials, verified sender or controlled delivery test is approved. The prepared command and settings are in `docs/staging-reconciliation-cron.md`. |
| Independent missing-run watchdog | **DEFERRED**: only pure decision logic is tested; scheduler, durable run/alert state, delivery and recovery have not been deployed. An in-process timer cannot detect a missing or killed run. |
| Full staging stock workflow and pagination at representative volume | **UNVERIFIED** for the current integrated release. Use approved, uniquely named staging records and retain posted ledger/audit history; inject drift only in a disposable database. |

## Stock-only production release preparation

The candidate release diff is `dfstock...phase-2/stock-counts`: 82 files,
covering stock routes/services/models, shared inventory contracts, React stock
screens, targeted tests, Mongoose `9.11.4`, and CSV/XLSX support. Release from
this stock-only branch after its own review and CI. Do **not** merge the
integration branch wholesale: it contains the temporary signed-login gateway,
client-IP diagnostic, staging rewrites and disposable test infrastructure.
Review stock-specific integration refinements separately, especially the
stock-action operation gate in `backend/src/modules/inventory/routes.ts` and
the reconciliation monitoring design, before deciding whether they belong in
the production patch.

Production currently disables automatic Mongoose index creation. Before
enabling stock counts, review and apply a separate index migration for the new
`stock_counts` collection: unique `countNo`, sparse unique `activeKey`,
`{ status: 1, createdAt: -1, _id: -1 }`, and
`{ itemId: 1, locationId: 1, createdAt: -1 }`. Review the additional
`stock_movements` index `{ postedAt: 1, itemId: 1, locationId: 1 }` and verify
existing indexes. New optional item description, unit conversion and
replenishment fields do not require a destructive backfill; existing
`stock_action_requests` records remain in their collection. Check index build
cost, uniqueness conflicts, deployment order and rollback on a disposable
database before touching production.

**Future index migration, requiring separate approval:** first confirm the
Atlas project/cluster and effective database are the intended production `ims`,
record a backup and the current `stock_counts` index listing, and use a scoped
index-management identity. If the collection already contains documents, check
for missing/null or duplicate `countNo` and duplicate present `activeKey`
values; stop on any conflict. Check existing index names, key order and options;
stop on a same-name or same-key mismatch rather than dropping or replacing an
index. Only after this review, run these idempotent `mongosh` statements against
the verified database during an approved maintenance window:

```javascript
if (db.getName() !== 'ims') throw new Error('Wrong database');
db.stock_counts.createIndex({ countNo: 1 }, { name: 'countNo_1', unique: true });
db.stock_counts.createIndex({ activeKey: 1 }, { name: 'activeKey_1', unique: true, sparse: true });
db.stock_counts.createIndex({ status: 1, createdAt: -1, _id: -1 }, { name: 'status_1_createdAt_-1__id_-1' });
db.stock_counts.createIndex({ itemId: 1, locationId: 1, createdAt: -1 }, { name: 'itemId_1_locationId_1_createdAt_-1' });
db.stock_counts.getIndexes();
```

Verify all four returned specifications, including `unique` and `sparse`,
before allowing stock-count writes. Repeating an identical `createIndex` is
safe; it does not correct a conflicting existing specification. The additional
`stock_movements` index needs its own existing-index and build-cost review.
If a build fails, stop the rollout and retain any successfully created indexes;
do not drop indexes or modify records as an automatic rollback.

The stock-only application uses the existing production MongoDB, authentication
and CORS configuration. Keep staging Atlas pins, staging gateway signing keys,
diagnostic flags and reconciliation-email credentials out of the stock-only
release unless each is separately designed for production. No production Cron
is included in this release. Before approval, verify the exact release diff,
dedicated branch CI, migrations, backup/snapshot, secrets and deployment target.
An integration-branch CI pass is not a stock-only-branch CI pass.

**Rollback:** record the current `dfstock` deployment and database backup;
prepare a code rollback to `cd3670b` before enabling new stock writes. If new
count or opening-batch records have already been committed, pause affected
actions and review compatibility before reverting code. Preserve append-only
movements and audits; never delete them or reverse stock automatically. Prefer
a reviewed forward fix when old code cannot interpret new records. Index
rollback is a separate database change, not part of application rollback.

**Production smoke tests after separate release approval:** check health and
database connectivity; Admin `/auth/me`; restricted-user `403` on approval and
reconciliation APIs; read-only item/location, balance, layer, movement, count
and request listings; then a read-only reconciliation with zero unexplained
differences. Record IDs, status codes and timings without credentials. Any
production opening, adjustment, transfer or count posting requires a distinct
controlled-write approval and retention plan.

## Phase 3 handoff

Begin with supplier profiles and purchase-order/GRN contracts that call the
existing FIFO `IN` engine. Keep landed-cost allocation and late cost effects
as explicit Phase 3 acceptance work. Phase 2 local implementation is ready for
handover, but production promotion and the deferred security/operations gates
remain separate decisions; none are marked passed by this document.
