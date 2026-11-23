# Disposable Atlas reconciliation volume test — prepared, inactive

These commands test reconciliation against a **separately approved disposable Atlas replica set**. They do not test stock-posting throughput, the nightly email notifier, or the operational `ims_staging` database. Do not provision Atlas or Render from this document alone.

## Release gates

1. Confirm the disposable Atlas project, cluster ID, and exact `mongodb+srv` hostname in the Atlas dashboard. The hostname must differ from operational staging and production. Review and replace `null` in `backend/scripts/volume-test/approved-target.json` with that exact hostname in a separate, approved code change. Until then every CLI fails before connecting.
2. Verify a separate fixture-writer identity has **only** `readWrite` on the chosen test database, and a separate runner identity has **only** `read` on that database. The scripts check the authenticated role after connecting, before accessing stock collections. Use distinct identities for `ims_volume_trial` and `ims_volume_full` if Atlas cannot scope one identity to exactly one database at a time.
3. Restrict the disposable Atlas project's network access to the approved Render job's outbound ranges. Do not reuse the operational staging service's Atlas credentials or Render environment group. Do not add `0.0.0.0/0`.
4. Review the test commit, test-only host pin, and Render service identity before any execution. `staging-mongo-isolation.ts`, the web-service isolation check, and the operational reconciliation Cron remain unchanged.

## Configuration and exact commands

Configure these **server-side** environment variable names for each command; never put values in commands, source control, logs, or reports:

- `NODE_ENV=production`
- `MONGODB_DB_NAME=ims_volume_trial` for `--scale=10`, or `ims_volume_full` for `--scale=100`
- `MONGODB_URI`: authenticated `mongodb+srv` URI with the approved hostname and exact database path
- `STAGING_ATLAS_HOST`: the operational staging hostname, for a distinctness check
- `PRODUCTION_ATLAS_HOST`: the production hostname, for a distinctness check

The URI path, `MONGODB_DB_NAME`, `--scale`, checked-in approved host, and effective Mongoose `dbName` must agree. The scripts reject URI database overrides, unapproved targets, missing host pins, and ambiguous scale arguments. `seed` requires the writer identity; `verify` and `run` require the reader identity. Use separate protected secret settings for those jobs.

Build from the reviewed repository root, then run one step at a time:

```sh
npm ci --include=dev && npm run build:shared && npm run build:staging -w backend
node backend/scripts/volume-test/seed.mjs --scale=10
node backend/scripts/volume-test/verify.mjs --scale=10
node backend/scripts/volume-test/run.mjs --scale=10
node backend/scripts/volume-test/seed.mjs --scale=100
node backend/scripts/volume-test/verify.mjs --scale=100
node backend/scripts/volume-test/run.mjs --scale=100
```

The commands above are **not ready to target Atlas** while `approved-target.json` contains `null`. Each seed command refuses any nonempty database and never deletes or overwrites documents. A partially seeded database must be investigated or replaced through a separately approved cleanup; do not retry the seed against it.

For an offline check before review, use an already installed local `mongod` binary in `MONGOMS_SYSTEM_BINARY`, then run `node --test backend/scripts/volume-test/volume.test.mjs` from the repository root. This test creates and stops its own local replica set; it does not read the Atlas URI.

## Render execution proposal

Use a **separate temporary job**, not the operational staging web service or its prepared nightly Cron. Provisional compute plan: `1c-2g` (1 CPU, 2 GB), Auto-Deploy Off, reviewed test commit pinned, no shared environment group, no web traffic. The build command is the command above. Run the scale-specific seed, verify, and measurement as separately authorized steps. Keep the job unscheduled or ensure it cannot run automatically before readiness checks; do not add it to the active `render.yaml`. Verify the service's outbound ranges in Render and allowlist them only in the disposable Atlas project. Capture the job ID and Atlas cluster ID before cleanup.

## Evidence and acceptance

| Scale | SKUs | Locations | Balances | FIFO layers | Movements | Expected checked pairs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10% | 100 | 5 | 500 | 2,000 | 10,000 | 500 |
| Full | 1,000 | 5 | 5,000 | 20,000 | 100,000 | 5,000 |

Record sanitized `verify` counts, `run` wall-clock `elapsedMs`, peak process `peakRssBytes`, actual streamed `scanned` counts, checked pairs, discrepancy count, exit code, Render peak-memory graph, cluster tier, and transaction setting. Timing starts immediately before reconciliation and excludes seeding and verification. A full pass requires exit `0`, no discrepancies, 5,000 checked pairs, expected streamed counts, less than 900,000 ms, and memory headroom below the 2 GB instance limit. Stop before the full run if the 10% trial fails, approaches the memory limit, or encounters a transaction expiry.

`run` performs one snapshot transaction attempt and makes no stock writes. Exit `2` means discrepancies and exit `1` means configuration, connection, authorization, or execution failure. Error output intentionally excludes URIs and database documents. The normal operational reconciliation call retains its existing transaction behavior.

Atlas's default transaction lifetime is 60 seconds. The 15-minute business target does **not** imply that a 15-minute snapshot transaction will succeed. Record the default-lifetime 10% result first. Any extension of transaction lifetime on the disposable cluster requires separate approval and an assessment of snapshot history and cluster resources. Do not change operational staging or production Atlas settings.

## Cleanup and recovery

If a step fails, stop the temporary job and retain the isolated data for investigation. Do not switch a job to `ims_staging` or rerun a nonempty seed. After evidence review, disable or remove only the identified temporary job, revoke its test identities and network access, remove its protected secrets, and delete only the identified disposable cluster and databases under separate authorization. Check Atlas backup retention and final billing. No inventory repair is part of this test.
