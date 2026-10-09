# RepoFinisher Incident Response

## Severity

Treat incidents involving credential exposure, unauthorized repository writes, corrupted approval state, or cross-user data access as security incidents.

Treat production frontend/API/worker outages as availability incidents.

## Frontend diagnosis — Vercel

Check:

- current deployment commit;
- deployment/build status;
- static asset/SPA routing;
- browser console/network errors;
- Supabase public variables;
- API base URL;
- canonical DNS.

If the browser is calling a `.run.app` RepoFinisher API, the deployment is stale or misconfigured.

## API diagnosis — Railway

Check:

- `repofinisher-api` latest deployment;
- build/runtime logs;
- `/api/healthz`;
- process restarts;
- required environment variable names;
- Supabase connectivity;
- CORS origin;
- upstream provider errors.

Use the Railway service domain to separate API health from custom DNS issues.

### API cooldown and shared-IP diagnosis

An application rate limit returns HTTP 429 with `code: "API_RATE_LIMITED"`, a
`limiter` of `global`, `expensive`, or `telemetry`, and numeric `retry_after`
seconds. `Retry-After`, `RateLimit`, and `RateLimit-Policy` are exposed to the
existing allowed browser origins. Upstream provider throttling is a separate
failure; do not infer that an upstream 429 exhausted the API's IP allowance.

The unchanged per-IP, per-process budgets are 300 API requests, 10 expensive
writes, and 30 client-error reports per minute. Expensive routes skip GET, HEAD,
and OPTIONS. All three limiters run before authentication; bearer-token claims,
user-ID headers, and caller-supplied identities cannot select a new bucket.

For each blocked request, API logs include `event: "api_rate_limited"`, its
limiter, method, bounded route label, limit, used count, reset time, and a
pseudonymous `ip_bucket`. The bucket is HMAC-derived from the actual limiter
key, including its default IPv6 subnet grouping. Its random key exists only
within that API process and changes on restart; compare buckets only within
the same process lifetime. These events do not contain raw IPs, tokens,
headers, bodies, query strings, repository names, or user identifiers.

To investigate safely:

- Group blocked events by process, `ip_bucket`, limiter, and reset time. A burst
  across history-list routes suggests repeat browser requests; check frontend
  request caching and polling before changing budgets.
- Compare `request_ip_source`, `trusted_forwarded_hops`,
  `forwarded_header_present`, `forwarded_header_entries`, and
  `selected_ip_equals_socket_peer` with the documented Railway proxy topology.
  These fields describe the existing selection without recording addresses.
  The app still trusts exactly one proxy hop. Multiple header entries alone do
  not prove incorrect attribution or authorize trusting more hops.
- A bucket can represent multiple tabs, devices behind one NAT, an IPv6
  subnet, or a proxy-selected address. Blocked events alone cannot count users
  or distinguish those causes. Confirm the deployed proxy path using trusted
  platform evidence and controlled requests before changing trust/keying.
- Verify the current frontend deployment, close excess tabs, allow the cooldown
  to expire, then perform one settings action. Inspect its Network response and
  matching sanitized event. Avoid production load tests or logging credentials
  and full forwarded headers to diagnose the issue.

Keep origin allowlists, authentication, rate-limit budgets and proxy trust
unchanged until evidence supports a bounded correction.

## Worker diagnosis — Railway

Check:

- `repofinisher-worker` latest deployment;
- start command;
- crash/restart loop;
- Supabase trusted key availability;
- worker polling errors;
- active session rows;
- `worker_token`, `lease_expires_at`, heartbeat state;
- GitHub/CI/provider failures for the affected session.

Do not manually clear leases until current worker/runtime evidence shows the lease is stale.

## Auth diagnosis — Supabase/GitHub

Check:

- Supabase GitHub provider enabled;
- correct Client ID/Secret;
- GitHub authorization callback URL points to Supabase Auth callback;
- Supabase Site URL;
- redirect allow list contains the frontend `/auth/callback`;
- provider token is returned/persisted as expected.

## DNS incidents

Frontend hostname must resolve to Vercel.

API hostname must resolve to Railway.

If either still resolves to Google Frontend/Cloud Run infrastructure, correct DNS before debugging application code at that hostname.

## Safe rollback

- Frontend: roll back to a known-good Vercel deployment.
- API/worker: roll back to known-good Railway deployments.
- Database: prefer forward recovery unless a migration has an explicit safe reversal.

Cloud Run is not the canonical emergency rollback target.

## Closure

Do not close an incident until the affected runtime and relevant user flow have both been verified.
