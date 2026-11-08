# Audit history: proposed read module

**Status:** Implemented locally on `feature/audit-history`, based on the authentication-security
commits. This implementation has not been pushed, merged, or deployed. The design below remains
the contract; a 20,000-row disposable-database index rehearsal and the production migration/rollback
steps are recorded in [the index migration plan](audit-history-index-migration.md). Production query
plans and rate limits still need review before release.

## Existing foundation

- The write service stores events in the append-only `audit_logs` collection with `at`,
  `actorId`, `action`, `entityType`, `entityId`, and optional `before`, `after`, and `metadata`.
  The legacy `audit_log` migration preserves older records.
- The backend already has `audit.read` in its permission vocabulary. Admin has `*`;
  Owner / Manager and Viewer / Auditor have `audit.read`. Storekeeper does not.
- The frontend already has an Audit navigation link at `/audit`, currently a protected
  placeholder. The project specification calls for `GET /audit-logs` and a searchable page.

## Read-only API

1. Add `GET /api/v1/audit-logs` and optionally `GET /api/v1/audit-logs/:id`. Both must use
   backend `requirePermission('audit.read')`; do not add mutation routes.
2. Validate query parameters with shared Zod contracts: `entity` (entity type), `entityId`,
   `user` (actor or affected user ID), exact `action`, UTC `from` and `to`, `limit` (default
   50, maximum 100), and an opaque `cursor`. Reject invalid IDs, dates, reversed ranges,
   oversized limits, and unsupported filters with `400`. Default to the last 30 days while
   allowing an explicit older range.
3. Sort by `(at DESC, _id DESC)` and return a cursor made from both values, so events with
   the same timestamp are neither skipped nor repeated. Return `{ data, meta: { nextCursor,
   hasMore } }`; avoid an expensive total count. Add a matching `(at, _id)` index and review
   query plans for the existing entity and actor indexes. A `user` filter should match
   either `actorId` or a user-target event's `entityId`, since failed login events have no
   authenticated actor.
4. List rows should return only ID, UTC ISO timestamp, action, entity type and ID, optional
   actor ID, and a safe summary. The optional detail route may return a redacted diff. Never
   serialize Mongoose `Mixed` `before`, `after`, or `metadata` directly to the client.
5. Record each audit-history read with the authenticated reader and filter *names*, result
   count, and record ID when applicable. Do not record raw query text. If this read-audit
   write fails, do not release the audit data.

## Data protection and access

- Use an allowlisted response serializer plus recursive read-time redaction. The existing
  write-time sanitizer does not prove that older migrated records are safe to expose.
  Suppress passwords, hashes, tokens, secrets, cookies, request bodies, and unknown fields;
  mask personal fields such as email in list summaries. Show only approved diff fields in
  the detail view.
- Keep `audit.read` as the backend authority and use the same permission for frontend
  navigation and the page gate. The existing role matrix deliberately includes Manager and
  Viewer / Auditor. If authentication-security events should be Admin-only, first approve
  a separate permission such as `audit.security.read` and a role migration; do not silently
  narrow the existing `audit.read` grant.
- Return `401` without a session and `403` without `audit.read`. Never rely on the hidden
  navigation item as the access control.

## React screen

- Replace the `/audit` placeholder with a page under `frontend/src/modules/audit/`, using
  the existing `PageHeader`, `Card`, `PermissionGate`, and authenticated API helper.
- Show newest events first in a responsive table: time, action, affected entity, and
  authenticated actor when present. Display times in `Africa/Nairobi` with the UTC ISO
  timestamp available in a tooltip or detail view. An absent actor means unverified or
  system-originated activity, not the affected user.
- Provide date range, action, entity type/ID, and actor/affected-user filters. Keep filters
  in the URL, reset the cursor when they change, and use server-side Next/Previous paging.
  Include loading, empty, validation-error, access-denied, and retry states. A detail panel
  shows only the server's redacted diff. Do not add export or edit controls in this phase.

## Acceptance checks for the later implementation

- Admin, Manager, and Viewer / Auditor can read; Storekeeper and unauthenticated callers
  receive `403` and `401` respectively, including direct API requests.
- Filtering, UTC boundaries, and cursor paging remain stable when timestamps are equal or
  new events arrive between pages.
- Legacy records and intentionally planted secret fields never reveal credentials or raw
  personal data through list or detail responses.
- Reading audit history itself creates a safe audit event; an audit-write failure releases
  no history. No POST, PATCH, or DELETE audit-history route exists.
