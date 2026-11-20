# Jobs

The read-only stock reconciliation job implements specification §5.4. After
building the backend, `npm run reconcile:stock -w backend` compares balances,
FIFO layers and movements in one committed MongoDB snapshot. It exits `0` for
no differences, `2` for differences and `1` for a configuration or job failure.
It never repairs stock. It is not scheduled yet.

For a local database-role check, build the backend, set `MONGOMS_SYSTEM_BINARY`
to an already installed local MongoDB binary and run
`node backend/scripts/verify-reconciliation-read-role.mjs` from the repository
root. The script starts its own authenticated in-memory replica set, confirms
that a `read@ims_staging` user can run the compiled job, then confirms a stock
write is denied. It does not test Atlas permissions, staging isolation or an
actual nightly schedule.

- eTIMS retry queue: Phase 6.
- Backups (`mongodump`): Phase 10.
