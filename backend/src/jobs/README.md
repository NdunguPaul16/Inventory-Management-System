# Jobs

The read-only stock reconciliation job implements specification §5.4. After
building the backend, `npm run reconcile:stock -w backend` compares balances,
FIFO layers and movements in one committed MongoDB snapshot. It exits `0` for
no differences, `2` for differences and `1` for a configuration or job failure.
It never repairs stock.

The staging entry point is `npm run reconcile:stock:staging -w backend` after
`npm run build:staging -w backend`. It checks the staging MongoDB database and
Atlas host isolation before connecting, without requiring the web service's
Key Value or authentication settings. It sends server-side email notifications;
missing notification settings or delivery failure exits `1`. The proposed
schedule and independent watchdog are in `docs/staging-reconciliation-cron.md`.
Neither entry point is scheduled yet.

For a local database-role check, build the backend, set `MONGOMS_SYSTEM_BINARY`
to an already installed local MongoDB binary and run
`node backend/scripts/verify-reconciliation-read-role.mjs` from the repository
root. The script starts its own authenticated in-memory replica set, confirms
that a `read@ims_staging` user can run the compiled job, then confirms a stock
write is denied. It does not test Atlas access or the staging preflight.

- eTIMS retry queue: Phase 6.
- Backups (`mongodump`): Phase 10.
