# Cloud onboarding

This page documents the signup → first-shuttle journey for DataShuttle
Cloud. The on-premises (OSS) first-run wizard (#567) is documented
separately in [Installation → First-run setup](../installation/README.md).

---

## Visual flow

```
┌─────────────┐     ┌────────────────┐     ┌─────────────────┐
│   /signup   │ ──▶ │ /verify-email  │ ──▶ │  /onboarding    │
│ (email+pw)  │     │ (email token)  │     │  (5-step wiz)   │
│     or      │     │                │     │                 │
│ SSO button  │     └────────────────┘     └─────────────────┘
└─────────────┘                                     │
       │                                            ▼
       │                                ┌─────────────────────┐
       └── (SSO) ──▶ /auth/sso/...   ──▶│ /shuttles/{name}   │
                 OAuth2 + 302            │ (live detail page)  │
                                         └─────────────────────┘
```

The three entry points all converge on the same onboarding wizard, which
is where plan selection, first-shuttle creation, and live ingestion
progress happen.

## Signup paths

### Email + password

1. User submits `/signup` form → `POST /api/v1/auth/register` creates a
   `User`, a personal `Org`, and an `Owner` `Membership`.
2. Backend mints a one-time `verification_token` and emails a
   verification link (`/verify-email?token=...`).
3. User clicks the link → `POST /api/v1/auth/verify-email` flips
   `email_verified` to `true`.
4. User is redirected to `/login`, signs in → `POST /api/v1/auth/login`
   returns a session JWT in both the JSON body (for API/CLI clients)
   and an `HttpOnly` `ds_session` cookie (for browsers).
5. The UI lands on `/onboarding`.

### Social SSO (Google, GitHub, Microsoft)

1. User clicks "Sign in with Google" (or GitHub / Microsoft) on
   `/login`.
2. Browser hits `GET /api/v1/auth/sso/:provider` → backend returns the
   provider's authorization URL + opaque PKCE `state` token (also
   stashed in the cluster KV so any pod can service the callback, see
   #557 task 5.3).
3. User authenticates at the provider. The provider redirects to
   `GET /api/v1/auth/sso/:provider/callback?code=...&state=...`.
4. Backend:
   - exchanges the code for an access token,
   - fetches userinfo,
   - looks up / provisions the matching `User` + personal `Org` +
     `Owner` `Membership`,
   - mints a session JWT via `SessionManager::mint(...)`,
   - sets `Set-Cookie: ds_session=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/`,
   - returns **302 Found** with
     `Location: /onboarding?sso=success&provider={provider}`,
   - emits an audit event `sso.login_success`.
5. The onboarding wizard reads `?sso=success` on mount, calls
   `AuthProvider.refresh()` to pick up the freshly set cookie, shows a
   transient toast `"Signed in with {Provider}"`, and strips the
   query parameters from the URL.

All three providers share the same callback machinery — the only
provider-specific bits are the authorization / token / userinfo URLs
and the userinfo JSON schema (parsed by `parse_userinfo` in
`crates/datashuttle-api/src/sso.rs`).

> **OSS note:** SSO is opt-in. If no provider credentials are configured
> in `config.yaml`, the `/auth/sso/*` routes return `503 Service
> Unavailable` and no cookies or sessions are involved. The rest of
> the product works exactly as it did before SSO shipped.

## Onboarding wizard

The wizard lives at `/onboarding` and walks the user through five
steps. Progress is persisted to `localStorage` under
`ds_onboarding_progress` so refreshes don't lose work.

| # | Step | Backend call |
|---|------|--------------|
| 1 | Organization name | (none — stored locally) |
| 2 | Plan selection | `POST /api/v1/billing/subscribe` → `api.subscribe(planId)` |
| 3 | Connection choice | (none — stored locally) |
| 4 | Create first shuttle | `POST /api/v1/shuttles` → `api.createShuttle(sql)` |
| 5 | Live ingestion | `WS /ws/shuttles` (filtered by shuttle name) |

### Plan selection

`api.subscribe(planId)` may return either:

- `{ url: "https://checkout.stripe.com/..." }` — the wizard
  redirects the browser to the Stripe-hosted checkout. After payment
  Stripe redirects back to the app; the wizard picks up from step 3.
- `{ status: "active" }` (or similar) — no payment needed; the wizard
  advances to step 3 immediately.

Error handling:

- **402 Payment Required** (past-due subscription) → toast +
  redirect to `/billing`.
- **5xx** → error toast with a "Retry" affordance, and the details are
  logged to the browser console for support.

### Create first shuttle

The wizard builds a `CREATE SHUTTLE ...` SQL string from the form
state and posts it to `/api/v1/shuttles`. Error handling:

- **429 Too Many Requests** (`quota_exceeded`) → inline message on the
  step with a "Upgrade plan →" link pointing to `/billing`.
- **402 Payment Required** → toast + redirect to `/billing`.
- **Other 4xx** → inline error message; user can fix and retry.
- **5xx** → error toast, console log, Retry button.

### Live ingestion

The wizard opens a WebSocket to `/ws/shuttles` (the same channel used
by the monitoring dashboard) and filters the event stream by the
shuttle name it just created. Each `rows_ingested` or
`batch_committed` event bumps the on-screen row counter and updates
the "Last commit" timestamp. No polling fallback is required once the
stream is live, but a low-frequency status poll (`GET
/api/v1/shuttles/{name}/status`) backs up the display until the first
event arrives.

### Finish

On "Finish", the wizard clears `localStorage` and navigates to
`/shuttles/{name}` — the shuttle detail page — so the user lands on
the same page they'd reach from the sidebar.

## Developer notes

- The session cookie is named `ds_session` and is always `HttpOnly`,
  `Secure`, `SameSite=Lax`, `Path=/`. The `Max-Age` matches the
  session TTL configured on `SessionManager` (default 24h).
- The `sso.login_success` audit event is written via
  `crate::audit::audit_log!` and lands in the standard audit sink
  (structured log + `AuditStore`). Per-tenant audit scoping follows
  the global rules in `docs/book/src/operations/audit.md`.
- First-time SSO users are auto-verified (the provider already vouched
  for the email), so they skip the `/verify-email` step entirely.
- The wizard is tolerant of backend drift: if `GET /billing/plans`
  fails (for example, in OSS mode with no billing configured), the
  step falls back to a baked-in community/team/business/enterprise
  list so the wizard still renders.
