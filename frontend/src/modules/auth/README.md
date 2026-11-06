# Frontend authentication (Phase 1A)

`AuthProvider` owns the signed-in user and an access token held only in memory. At startup it
posts to `/api/v1/auth/refresh` using the backend's HttpOnly `ims_refresh` cookie, then reads
`/api/v1/auth/me` with the returned bearer token. A missing or expired cookie sends protected
routes to `/login`. Login uses `/api/v1/auth/login`; logout uses `/api/v1/auth/logout` and clears
cached client queries after the server confirms revocation. Passwords and refresh tokens never
go to browser storage.

All requests use the same-origin `/api/v1` path with `credentials: 'include'`. The backend
currently relies on the HttpOnly, SameSite=Lax refresh cookie and does not expose a CSRF token
endpoint. Frontend API calls should use `useAuth().authorizedRequest(path, schema, options)`;
it retries one 401 after a single shared refresh and clears the session if recovery fails.
Backend permission checks remain authoritative. `visibleNavigation` and `PermissionGate` use
the same exact/wildcard matching rule as backend `hasPermission` to guide navigation. A new
protected page should use its backend read permission for both its menu item and route gate.

`reloadUser()` updates `/auth/me` after an administrator changes their own account or a role
assigned to them, so menu permissions reflect the server's current role assignments.

Phase 1 still needs settings, master data, and item screens. Those routes continue to show the
existing placeholders until implemented.
