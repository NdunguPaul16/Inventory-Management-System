# Stock engine

The FIFO stock ledger lives here: `postIn`, `postOut`, `transfer`, `reverse`.
It is the only code allowed to write `stock_movements`, `cost_layers` and
`stock_balances` (spec §3, §5).

The service and ledger models are implemented here. Future Phase 2 work remains tracked in the development roadmap.

Run `npm run test:engine:coverage -w backend` from the repository root to
measure the engine against its per-file 90% line-coverage gate. The test suite
uses an isolated MongoDB replica set; it does not connect to a deployed
database.

`reconcileBalances()` compares balances, FIFO layers and posted movements in
one read-only MongoDB snapshot. It streams ledger records and retains one
aggregate per item and location, avoiding an in-memory copy of every movement.
The permission-gated API exposes the result to
authorised users. After building the backend, `npm run reconcile:stock -w backend`
is the scheduler entry point: exit code 0 means no differences, 2 means drift,
and 1 means the check failed. It requires explicit `MONGODB_DB_NAME` and
`MONGODB_URI` settings, prints counts only, and never repairs stock. Configure
the nightly schedule and alert destination separately for the intended database.

Historical valuation reads `stock_movements` through an inclusive UTC `postedAt`
cutoff and sums recorded quantities and whole-cent `totalCost`. The compound
`{ postedAt: 1, itemId: 1, locationId: 1 }` index is declared on the movement
model. Deployed services set `autoIndex: false`, so a database administrator must
review and create this index on an isolated staging database before enabling
large historical queries. Confirm an `IXSCAN` in `explain` with representative
volume. Roll back the index only after the query is withdrawn and its use has
been checked; no application startup performs that migration in production.
