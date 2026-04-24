# Billing

## DPU Metering

All usage is measured in DPUs (DataShuttle Processing Units):

| Activity | DPU |
|----------|-----|
| 1 GB data processed | 1 DPU |
| 250,000 CDC events | 1 DPU |
| 1 connector-hour | 1 DPU |

Usage is tracked in real-time via atomic counters and periodically flushed
to the usage ledger.

## Deployment Modes

| Mode | Enforcement | Reporting |
|------|------------|-----------|
| Cloud | Hard — reject over-quota requests | Real-time via event stream |
| Self-hosted | Soft — 30-day grace on overage | 24h push to portal |
| Airgapped | Honor-based | Quarterly export |

## Stripe Integration (Cloud)

- Subscriptions managed via Stripe: Team, Business, Enterprise plans
- Community tier: 10,000 DPU credit automatically applied
- Usage-based billing: DPU consumption reported at billing cycle end
- Overage: billed at next-tier-down rate
- Customer portal: manage payment methods, view invoices

## API Endpoints

```
GET  /api/v1/usage                 — Current DPU usage and quota status
GET  /api/v1/usage/pipelines       — Per-pipeline DPU breakdown for period
GET  /api/v1/billing/plans         — Available subscription plans
GET  /api/v1/billing/customer      — Current subscription / customer state
GET  /api/v1/billing/invoices      — Invoice history (Stripe-hosted PDFs)
POST /api/v1/billing/portal        — Create Stripe Customer Portal session
POST /api/v1/billing/subscribe     — Start or change subscription
POST /api/v1/billing/webhook       — Stripe webhook handler
```

## Quota Enforcement

- At 80% DPU usage: warning in logs and yellow banner in UI
- At 95%: red banner + `quota_exceeded_seen` analytics event fires
- At 100% (cloud): new pipeline creation blocked with upgrade message
- At 100% (self-hosted): warning only, 30-day grace period
- Airgapped: no enforcement, contractual compliance

## Usage Dashboard (`/usage`)

The UI at `/usage` provides:

- **Hero card**: current-period total DPU consumption, the plan DPU limit,
  and a colour-coded progress bar (green < 80%, yellow 80-95%, red > 95%).
  The progress bar exposes `role="progressbar"` with `aria-valuenow` for
  screen readers.
- **Quota warning banners**: rendered above the hero when usage crosses
  80% and 95% thresholds. The 95% banner emits the `quota_exceeded_seen`
  analytics event exactly once per page-load.
- **Breakdown cards**: DPU split by source — batch ingest, CDC events and
  connector time — so operators can see which dimension is dominating cost.
- **30-day timeseries**: a line-chart of daily DPU consumption, plus a
  companion bar-chart for the same window. Period selector (7d / 30d /
  current cycle) in the top-right of the page.
- **Top-pipelines table**: ranked by total DPU with per-source columns and
  `% of total` share. The table carries an `aria-label` and a
  `<caption class="sr-only">` so screen readers announce its purpose;
  the sorted column uses `aria-sort="descending"`.
- **Plan details** strip at the bottom: tier name, quota, environments
  used / max, current billing period start.

> **Screenshot:** _placeholder — capture at 1440x900 with the 30-day chart
> populated and a pipeline using >50% of quota. Replace this note with a
> `![Usage dashboard](./img/usage-dashboard.png)` include when the real
> screenshot lands. The exact selectors above should be stable enough to
> automate with Playwright._

## Billing Page (`/billing`)

The UI at `/billing` is the operator's self-service surface for managing
subscription, payment and invoices. Sections:

1. **Current Plan card**
   - Tier name in large type.
   - Coloured status pill: `awaiting_approval` (purple), `active`
     (green), `past_due` (yellow), `canceled` / `unpaid` (red).
     Community-tier accounts carry the `active` pill — Community is
     the entry tier, not a transitional state.
   - Renewal / cancellation date derived from `current_period_end` and
     `cancel_at_period_end`.
   - Last-4 of the payment method when present.
   - `Manage payment method` button opens the Stripe Customer Portal via
     `POST /api/v1/billing/portal` and redirects the browser to the
     returned `url`.
   - Feature matrix (DPU limit, environments, CDC, RBAC, SSO/SAML,
     Clustering, Audit Log, Airgapped) that lights up based on tier.

2. **Plan Comparison**
   - One card per available plan from `GET /api/v1/billing/plans`.
   - Current plan highlighted with a blue border and a star icon.
   - Upgrade / Downgrade CTA calls `POST /api/v1/billing/subscribe`. If the
     response returns a `url`, the browser is redirected to the Stripe
     checkout page. Clicking the CTA also emits an `upgrade_clicked`
     analytics event (`from`, `to`, `direction`).

3. **Invoice History**
   - Table populated from `GET /api/v1/billing/invoices`.
   - Columns: `Invoice`, `Date`, `Period`, `Amount`, `Status`, `Download`.
   - `Download` links to the Stripe-hosted PDF URL (`invoice.pdf_url`);
     Stripe hosts the canonical tax-compliant document, so DataShuttle
     itself never needs to generate PDFs.
   - Empty state: "No invoices yet. They will appear here after your first
     billing cycle."
   - Table carries `aria-label` and a `<caption>` for a11y.

4. **Payment & Billing Portal**
   - Prominent secondary CTA to open the Stripe portal (same endpoint as
     `Manage payment method` in the header).

> **Screenshot:** _placeholder — capture each of the four sections at
> 1440x900 with an `active` Team-tier customer and a populated invoice
> list._

## Mobile breakpoints

Signup, login, verify-email, usage and billing pages have been audited at
a 375px viewport. Tailwind `sm:` and `md:` breakpoints ensure all form
controls remain tappable and the usage hero + billing card stack vertically
on small screens.

## Accessibility

Form inputs on `/login` and `/signup` use `htmlFor` / `id` pairing and
`autoComplete` tokens so password managers and screen readers work
correctly. Error surfaces use `role="alert"` + `aria-live="polite"`.
Progress bars use `role="progressbar"` with `aria-valuemin` /
`aria-valuemax` / `aria-valuenow`. Tables expose `aria-label` and, where
a column is sorted, `aria-sort`.

## Analytics events

The UI emits product-funnel events via `ui/src/analytics.ts`. The default
adapter logs to `console.log`; swap in a PostHog / Mixpanel / Segment
adapter during `main.tsx` bootstrap via `setAdapter(...)`.

| Event | Fired on |
|-------|----------|
| `signup_started` | Signup page mount |
| `signup_email_verified` | Verify-email page mount with `?verified=1` |
| `signup_completed` | `POST /auth/register` 2xx |
| `onboarding_step_completed` | Each wizard `Next` click |
| `pipeline_created_from_onboarding` | Wizard step 4 pipeline create |
| `quota_exceeded_seen` | Usage page mount with `usage.over_limit` true |
| `upgrade_clicked` | Plan-comparison CTA click on Billing page |
