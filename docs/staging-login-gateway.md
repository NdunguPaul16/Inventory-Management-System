# Staging login identity gateway

The two-network diagnostic showed that Express selected the same socket-peer IP
for laptop Wi-Fi and Samsung mobile-data traffic. This temporary staging-only
gateway supplies a verified per-client login identity without changing Express
proxy trust or normal production authentication.

## Routing and authorization boundary

- The Vercel Preview deploys `frontend/api/v1/auth/login.ts` as the exact
  `/api/v1/auth/login` Function. Vercel's filesystem routing must take precedence
  over the broad `/api/:path*` rewrite. Verify this in the actual Preview before
  relying on the gateway. Other API paths keep the existing rewrite.
- The Function runs only when `VERCEL_ENV=preview` and
  `VERCEL_GIT_COMMIT_REF` is `staging/security-audit` or
  `integration/phase-2-security`. The Vercel build fails outside those exact
  contexts. Confirm Preview protection in the Vercel project before releasing
  either branch; the branch guard cannot verify that project setting. A normal
  local Vite build excludes Function code from `frontend/dist/`.
- The Function reads Vercel's overwritten `X-Forwarded-For` value, requires one
  canonical IP, and HMAC-pseudonymizes it. The backend receives no raw client IP.
  It forwards one normalized login POST to the pinned staging Render origin,
  with no redirects or retries, then passes through only the JSON status, refresh
  cookie, Retry-After and request ID.
- The staging backend requires a signed assertion before login's Redis limiter
  or credential checks. Unsigned direct Render password logins receive a generic
  403. The normal backend build contains no staging gateway implementation; the
  staging backend refuses to start from that build against `ims_staging`.
- The assertion binds the version, POST method, exact path, issuance time,
  random nonce, pseudonymous client identity and SHA-256 hash of the normalized
  login body. It is valid for at most 30 seconds, with 5 seconds of future clock
  skew. The backend claims the nonce atomically for 60 seconds in the existing
  shared rate-limit store. Replay or an unavailable store fails closed.

## Required settings, only when a deployment is separately approved

On **staging Vercel Preview** and **staging Render**, set the same server-side
`STAGING_LOGIN_GATEWAY_KEY_CURRENT` value: 32 random bytes encoded as 64
lowercase hexadecimal characters. Keep it out of `VITE_` variables, bundles,
Git, terminal history and logs. Do not reuse JWT, Atlas or Valkey secrets.

Render alone may also have `STAGING_LOGIN_GATEWAY_KEY_PREVIOUS` during rotation.
It must be a different 64-character lowercase hex key. Leave it absent during
initial setup. Missing or invalid signing configuration prevents staging login
and can prevent staging backend startup. No credential or secret value belongs
in this document.

The existing `AUTH_TRUSTED_PROXY_CIDRS` value remains unchanged. The existing
per-account limiter stays active. The old socket-peer per-IP bucket is replaced
only for admitted staging login requests, so it cannot retain the observed
cross-network collision. Protect the public endpoint from aggregate floods at
the hosting edge; a global shared-peer 10/minute bucket would recreate the
collision.

## Release gate: prevent signed traffic reaching the old backend

The old staging backend does not redact the new assertion header. A new Preview
login sent to that backend can place a short-lived signed assertion in Render
logs. **Do not send or permit login traffic through the new Preview while the
old backend is running.** Vercel's existing Require Log In / Standard Protection
limits access to the Preview, but does not prevent authorized project members
from using its login route. A request to avoid logging in is not an access
control.

Before a Preview-first release, record the exact staging service, both source
commits, the protected Preview deployment and every class of actor able to use
it during the transition: project members, granted collaborators, automation
and holders of any protection bypass. Confirm protection remains enabled. Then
establish and verify a **provider-enforced block on POST login for that entire
new Preview deployment**, including its immutable URL and any alias, for all
of those actors. The block must remain effective until the new backend is Live;
record the control, its scope, owner and control-plane evidence in the release
record. Merely keeping the URL private, changing an alias or warning testers
does not meet this gate. No such block has been verified for this project, so
the Preview-first release is currently **BLOCKED**.

If that block is verified and deployment is separately approved, prepare the
matching server-side key on both staging services. Deploy the protected Preview
first while login remains blocked. Use Vercel deployment and build metadata to
confirm its source commit, Preview environment, protection and Function artifact;
do not invoke login or claim runtime Function precedence from metadata. Deploy
the updated staging backend next. Use Render deployment metadata to confirm its
source commit, Live status and staging isolation preflight. Only after the new
backend is Live may the login block be lifted and separately budgeted live tests
be authorized. Those tests must establish actual Function precedence over the
broad rewrite, platform client-identity availability and trustworthiness, a
real login response and refresh-cookie rotation, direct Render login rejection,
corrected per-IP separation and spoof resistance. Do not use live Admin
credentials for denial tests.

If a provider-enforced block cannot be established, a separately approved
**backend-first alternative** avoids sending signed assertions to the old
backend: deploy the new backend while the old Preview remains in use, accept a
temporary staging login outage because unsigned logins will return 403, then
deploy the protected new Preview. Do not call this a zero-interruption release.
Validate the compatible pair under a separate live-request budget. Keep
production deployments and `dfstock` unchanged.

### Failure and rollback

- **Case A — backend deployment fails before login is released:** keep the new
  Preview's login route blocked. Restore the prior Preview and verify its source
  commit and protection using deployment metadata. Withdraw or quarantine the
  new Preview's immutable URL and aliases, and verify the block remains in force
  before allowing the old backend to serve login. Never send a signed login to
  the old backend. If the block cannot be confirmed, stop and treat the release
  as unresolved.
- **Case B — both components are deployed and rollback is needed:** stop new
  gateway login traffic with a verified provider-enforced block covering the
  new Preview's immutable URL and aliases. Restore the old Preview **first** and
  verify its deployment metadata and protection. Keep login unavailable while
  it points to the new signed-only backend. Restore the old backend **second**;
  resume login only after the old compatible pair is confirmed and the new
  Preview cannot send assertions to it. Repointing an alias alone does not
  disable an existing Preview URL. If the block or withdrawal cannot be
  verified, do not restore the unredacted backend while the new Preview remains
  reachable for login.

A zero-interruption rollback would require a separately reviewed compatibility
deployment; this plan does not provide one. Keep signing keys private. No
rollback or infrastructure change is authorized by this document alone.

To rotate signing keys, put new key B in Render's current setting and old key A
in its previous setting, then deploy Render. The existing Vercel Function can
still sign with A. Update Vercel's current key to B and deploy its protected
Preview. After the 30-second assertion lifetime and 60-second replay window,
remove A from Render. A key change also changes pseudonymous per-IP keys and
starts new fixed windows; schedule rotation during low staging traffic and
document that short transition. Key rotation rollback while both gateway
components remain deployed is separate from the binary rollback above.

## Verification status and request authorization

- **Locally verified:** method, path, timestamp, nonce and body binding;
  signature verification; atomic replay and rate-limit behavior; fail-closed
  responses; logging redaction; and normal-build artifact isolation. These are
  local code and test results, not deployed-provider proof.
- **Still required at deployment:** the enforced login-traffic block or an
  approved backend-first outage; actual Function precedence over the rewrite;
  trustworthy Vercel-provided client identity; matching server-only signing
  keys on staging Vercel and Render; and compatible source commits. No signing
  key may use a `VITE_` or other browser-exposed variable.
- **No application HTTP request needed:** inspect GitHub CI, Vercel build and
  Function deployment metadata, Preview protection and audience, Render
  deployment metadata, and the documented traffic-block control. These checks
  do not prove runtime routing, cookie handling or client identity.
- **Separate approval and request budget required:** any live login, refresh,
  routing, cookie, direct-Render denial, per-IP separation or spoof-resistance
  request. Current authorization for new gateway login requests is **zero**.
  The completed diagnostic used 5 of 6 approved GETs; controlled health checks
  used 2 of 2. Do not reuse those allowances for gateway testing.

Do not declare the correction ready for production consideration until the
deployment-time properties are observed and recorded without exposing raw
addresses, credentials or signing material.
