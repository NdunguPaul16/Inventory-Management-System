# Authentication failure policy

- A valid login request receives the same `401 UNAUTHENTICATED` response and message for an
  unknown account, inactive account, locked account, or incorrect password. The existing
  five-failure, 15-minute account lockout remains in force. Rejected accounts use a dummy
  Argon2 verification to reduce easy timing differences; this is not a constant-time guarantee.
- The authentication service attempts an audit event for every credential request it handles.
  Failed attempts record a reason and, for a known account, its internal user ID. An
  unknown account is recorded as `authentication_attempt` / `unidentified`. No submitted
  email, password, request body, token, or authenticated actor is recorded for failures.
  Malformed requests rejected by input validation do not reach this service. Requests denied
  by the pre-login rate limiter also do not reach this service; HTTP access logging records
  their `429` or `503` response without causing one MongoDB write per denied request.
- Authentication fails closed if audit persistence fails. The API returns a generic `500`
  in production and issues no token or refresh cookie. Failed-password counters and their
  audit event share one MongoDB transaction; successful login, refresh, and logout also
  commit session changes with their audit events. An audit outage therefore cannot grant
  access, although a failed-password counter update is rolled back with its missing audit.
- Production uses shared Render Key Value counters before password verification, with
  conservative proxy trust and fail-closed behavior. The per-account lockout is still
  enforced. See [the rate-limit review](../../../../docs/auth-rate-limit-review.md) for
  thresholds, shared-network trade-offs, and remaining edge-protection work.
