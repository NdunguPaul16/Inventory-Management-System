# Phase 1B administration handoff

## Existing API contract

The frontend uses `GET/POST /api/v1/users`, `PATCH /api/v1/users/:id`,
`GET/POST /api/v1/roles`, and `PATCH /api/v1/roles/:id` through the Phase 1A
`authorizedRequest` helper. Shared Zod schemas validate requests and responses.
User email cannot be edited through the current backend contract; `isActive`,
name, password, and role assignments can. System role names and permissions are
immutable in the backend; the UI allows description edits only. Backend
permission checks remain authoritative.

The list endpoints return complete arrays without server-side search or paging.
The users page therefore searches, filters, and paginates the loaded array in the
browser (10 users per page). Revisit this when server-side pagination is added.
The role editor groups known permissions by module and accepts additional strings
that pass the shared `permissionSchema`; the backend owns the permission rules.

## Local validation and Phase 1A runtime correction

The combined `npm run dev` command failed on this Windows host when `tsx watch`
could not start (`uv_os_get_passwd` reported `ENOMEM`). Running the compiled
Node backend and Vite separately against the backend's disposable in-memory
MongoDB allowed a live proxy smoke test. That test exposed a CommonJS/ESM
interop error: the compiled backend's `jsonwebtoken` namespace import had no
`sign` function. Using the default import resolved it. Login, `/auth/me`,
refresh-cookie rotation, and logout then succeeded through the Vite proxy.
Users and roles listing, creation, user deactivation, and the SPA route also
succeeded against that disposable instance. No live database or credentials
were used.

Interactive browser automation was attempted, but Computer Use stopped because
its Windows browser host was unavailable and it could not verify the current
browser URL. Browser-only visual checks remain unverified on this host; frontend
route and form behavior is covered by automated React tests.

Vercel and Render deployment tasks remain deferred.
