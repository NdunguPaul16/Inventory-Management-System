# Authentication rate limit and proxy review

## Policy and failure behavior

`POST /api/v1/auth/login` validates its body, then consumes three fixed-window counters
before any account lookup, Argon2 check, or MongoDB audit write. The initial limits are
10 requests per minute and 60 per hour for a client network address, plus 5 requests
per 15 minutes for a normalized account email. Each value has an `AUTH_LOGIN_LIMIT_*`
environment override. A denied request returns a generic `429 RATE_LIMITED` and
`Retry-After`; it does not claim whether the account exists. Malformed bodies receive
`400` before consuming a slot.

Production counters use one atomic Lua operation in Render Key Value. The internal
`AUTH_RATE_LIMIT_REDIS_URL` is required in production; startup fails if the store
cannot initially connect. If it fails later, login returns a generic `503` before
password verification or audit writes, and `/api/v1/health` returns `503` with
`authRateLimit.status=down`. Existing refresh and logout behavior is unchanged.
The Redis client stops retrying after three reconnect attempts, so an extended outage
requires a service restart after Key Value recovers. Development without a Redis URL
uses an in-process store, suitable only for a single local process.

Every request to login, including a `429` or `503`, is covered by HTTP access logging.
Rate-limit denials do not create individual MongoDB audit records: doing so would allow
the request flood to keep producing database writes. Admitted invalid, unknown,
inactive, and locked-account attempts retain the existing fail-closed audit policy.
Counter keys contain HMAC digests of the normalized email or resolved IP address,
using the access-token signing secret as a key; neither identifier is stored in raw
form in Key Value. Do not log Redis URLs, credentials, submitted passwords, or tokens.

## Trusted client address

Vercel serves the frontend and proxies `/api/*` to the public Render backend. Vercel
overwrites its incoming `X-Forwarded-For`, but the Render URL is also directly
reachable. An arbitrary caller can send forwarding headers straight to Render.
Consequently, the Express default is `trust proxy=false`. Set
`AUTH_TRUSTED_PROXY_CIDRS` only to proxy ranges shown by a staging trace to be both
controlled and consistent; never set `true` or a guessed hop count. Express then
walks the forwarding chain from the socket outward and selects the nearest untrusted
address. Spoofed values to its left cannot select a new limiter identity.

The conservative default may identify Vercel's egress or Render's ingress as the
client. Many legitimate users can then share one IP budget and receive `429`. This
is an availability trade-off, not evidence that the browser IP has been verified.
Before production rollout, use a staging Render service and a disposable database:

1. Send controlled login requests via the Vercel rewrite from two unrelated networks
   and directly to Render. Record the socket peer and forwarding chain only in a
   short-lived protected staging diagnostic, without credentials or full request
   bodies. Remove the diagnostic before release.
2. Confirm which proxy replaces each forwarding header, whether direct traffic has
   the same chain, and whether a stable allowlist of controlled proxy IP ranges exists.
   With a staging-only one-request-per-minute limit, show that changing a caller's
   leftmost `X-Forwarded-For` does not reset the budget, while separate verified
   client networks are independent. Restore the intended limits afterward.
3. If the browser address cannot be authenticated at Render, keep the conservative
   peer identity and revise the architecture before relying on per-client fairness.
   Options are a signed header from a controlled Vercel function plus signature
   verification at Render, or network-level source restrictions where the Render
   plan supports them. A plain header or guessed CIDR is insufficient.

Render edge protection addresses network floods, but targeted HTTP floods still need
application controls. Place a Vercel/Render edge WAF or equivalent challenge/rule in
front of login when available. A distributed attack across many IPs and distinct
unknown emails can still cause substantial Argon2, audit, and Key Value load within
the per-address budgets. The account-wide limit also means an attacker can exhaust
a victim's sign-in budget; the existing five-failure account lockout already has a
similar targeted denial risk. Review these limits with real staging traffic before
altering production values. A single shared IP behind Vercel can exhaust the budget
for unrelated users, so the proxy identity check is a release gate.

## Tested and outstanding

Automated tests cover direct-header spoofing, the nearest untrusted hop, shared-IP
and shared-account budgets, denied requests without audit amplification, malformed
bodies, and fail-closed store outages. A real Render Key Value connection and the
Vercel-to-Render forwarding chain have not been exercised locally; both require
staging infrastructure. No production limits or live accounts were changed.
