# Audit History index migration

The read API sorts by `at DESC, _id DESC` and uses both values in its cursor. Its
Mongoose model declares `{ at: -1, _id: -1 }`, named `at_-1__id_-1`. Production
starts Mongoose with `autoIndex: false`, so deployment does **not** create this index.
Without it, a growing audit collection can require a full scan and blocking sort.

## Preflight

Use a disposable staging MongoDB replica set before production. Confirm the target
database name explicitly; do not use the default `ims` for the isolated rehearsal.
Back up `audit_logs` and any remaining `audit_log` before the release. The existing
startup migration moves legacy `audit_log` records transactionally into `audit_logs`
and removes the empty legacy collection, so preserve both collections in the backup.
Check available Atlas M0 storage and schedule index creation during low traffic.

In `mongosh` connected to the **intended** database, review existing indexes and
create only the required compound index:

```javascript
db.getName()
db.audit_logs.getIndexes()
db.audit_logs.createIndex({ at: -1, _id: -1 }, { name: 'at_-1__id_-1' })
db.audit_logs.getIndexes()
```

If an index with the same keys already exists, verify its name and avoid a duplicate.
Do not drop any existing index while introducing this one. The application can be
deployed after the index has been confirmed and the staging API checks pass.

## Query-plan rehearsal

The automated disposable-replica-set test inserts 20,000 representative audit rows,
then explains a 50-row newest-first page over the default 30-day range. It verifies
the winning plan uses `at_-1__id_-1`, examines at most 50 documents and 51 keys,
and returns without a collection scan. Repeat the explain in staging with its own
data and the actual list query:

```javascript
db.audit_logs.find({
  at: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), $lte: new Date() }
}).sort({ at: -1, _id: -1 }).limit(50).explain('executionStats')
```

Check `winningPlan` for `IXSCAN` on `at_-1__id_-1`,
`executionStats.totalDocsExamined`, and `totalKeysExamined`. Other combinations
of actor, entity, and action filters need staging query-plan review with realistic
selectivity; this single index does not guarantee every filter is efficient.

## Rollback

If the new API must be rolled back, revert its application deployment first. Leave
the index in place unless its storage or write overhead is a problem: an unused
index does not alter audit data. If removal is required, verify `db.getName()` and
`getIndexes()` again, then execute only:

```javascript
db.audit_logs.dropIndex('at_-1__id_-1')
```

This removes the index, not records. Do not reverse the legacy collection migration
by copying or deleting audit events. Recover collections from the preflight backup
only if a separate data-loss investigation establishes that recovery is necessary.
