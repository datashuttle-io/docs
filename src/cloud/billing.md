# Billing & Dunning (SaaS)

> **OSS users:** the billing webhook handler is compiled in every build,
> but the dunning cron and Stripe usage reporter only run when the API
> server is built with the `saas` cargo feature. Default OSS deployments
> seed an in-memory `BillingRepository`, never spawn the cron, and never
> need a Stripe key. You can ignore the rest of this page.

DataShuttle Cloud's billing layer covers two responsibilities:

1. **Webhook ingest** — turn Stripe `invoice.*` and
   `customer.subscription.*` events into mutations on the
   `billing_customers` / `billing_invoices` tables.
2. **Dunning** — escalate failed payments from a polite reminder to a
   tenant suspend to (eventually) a downgrade back to Community.

There is no time-boxed paid trial. Every new Cloud account lands in
**Community** (see
[BUSINESS-MODEL §3.3](../../../BUSINESS-MODEL.md#33-community-tier-the-free-entry-tier)
and [LICENSING — Cloud signup flow](../../../LICENSING.md#signup-approval-cloud-beta)).
Upgrading to Team or Business requires a payment method on file and
takes effect immediately; downgrading on dunning drops the tenant back
to Community with existing data intact.

Both pieces share the [`crate::notifications::NotificationSender`]
trait. In the default build it's a [`LogNotificationSender`] stub that
just writes a `tracing::info!` line; **Phase 4** swaps in the
SMTP/SES-backed implementation. The signup-approval emails
(`send_signup_approved`, `send_signup_rejected`) flow through the same
trait — see
[SAAS-PRODUCTION-PLAN §4.1](../../../../.planning/SAAS-PRODUCTION-PLAN.md#41-email-service).
No new mandatory env vars.

---

## Lifecycle overview

```
awaiting_email_verification  ─►  awaiting_approval  ─►  community (active)
                                                              │
                                                              ▼    upgrade + attach card
                                                              active (paid tier)
                                                              │
                          ┌───────────────────────────────────┤
                          ▼                                   ▼
                    past_due (dunning)                    cancel_at_period_end
                          │
                          ▼  14d grace
                    community (active)        ← downgrade, data retained
```

- The two top-of-funnel states — `awaiting_email_verification` and
  `awaiting_approval` — are owned by the signup flow and the admin
  approval queue. See
  [ADMIN-CONSOLE-PLAN §9.2](../../../../.planning/ADMIN-CONSOLE-PLAN.md#92-signup-approval-queue).
  The tenant provisioning saga does **not** run until admin approval.
- Once approved the user lands in `community` with the standard 10,000
  DPU/month grant. That is the free entry tier — not a trial, no
  deadline, no card required.
- Upgrading to Team or Business creates a Stripe subscription and flips
  `status = active` once the first invoice succeeds.
- If a subsequent invoice fails, the dunning state machine below drives
  the account back to Community rather than `canceled` — operators
  asked for "don't make customers re-signup after a lapse" on the #823
  design review.

---

## Dunning timeline

```
T+0   invoice.payment_failed (attempt 1) → DunningReminder mail
T+1d  Stripe retry → if it fails: attempt 2 → DunningReminder mail
T+3d  Stripe retry → if it fails: attempt 3 → status = PastDue
                                            → tenant suspended
                                            → DunningFinal mail
                                            → audit: billing.dunning.suspended
…
T+14d sweep_past_due cron flip → tier = community, status = active
                              → tenant resumed with Community limits
                              → SubscriptionDowngraded mail
                              → audit: billing.dunning.downgraded
```

Constants live in `crates/datashuttle-api/src/billing/dunning.rs`:

| Constant | Value | Purpose |
|---|---|---|
| `MAX_PAYMENT_RETRIES` | `3` | Failures before suspend |
| `PAST_DUE_GRACE_DAYS` | `14` | Days in `PastDue` before downgrade |

A successful `invoice.paid` at any point calls
[`crate::billing::dunning::on_payment_succeeded`], which:

* resets `payment_failure_count` to 0,
* flips status back to `Active` on the paid tier,
* automatically resumes the tenant **iff** it is currently `Suspended`
  (manual operator suspends are preserved).

### Retry queue design

Stripe drives the retry cadence itself (Smart Retries / configurable
schedule). DataShuttle does not maintain its own retry queue — every
fresh `invoice.payment_failed` webhook flows through
`on_payment_failed`, increments the counter, and (on attempt 3)
escalates. This means the state machine survives API restarts: it is
fully derived from `payment_failure_count` in the database.

If your Stripe account does not enable Smart Retries, you can layer an
in-process `BinaryHeap<(DateTime, customer_id)>` driver — but for
control-plane operators this is not required. A future revision may
add a `payment_retry_jobs` table when we want operator-overridable
retry windows. For now: **Stripe's retry policy is the source of
truth**.

---

## Tier-specific entry paths

* **Community** is the entry tier for every approved Cloud signup. A
  `BillingCustomer` row is created with `status = active`,
  `tier = community`, `stripe_customer_id = NULL`,
  `subscription_id = NULL` — the tier row exists from day one so the
  [QuotaGuard](../operations/billing.md) middleware can always resolve
  a tier.
* **Team** and **Business** upgrades go through Stripe Checkout
  (`POST /api/v1/billing/subscribe`). The webhook handler flips
  `tier` + `status` once `invoice.paid` confirms the first charge.
  There is no trial period on the Stripe subscription; billing begins
  on subscription creation.
* **Enterprise** signups bypass the self-serve checkout entirely —
  Sales provisions the customer record via the admin API after
  contract execution.

---

## Hooking a real email sender (Phase 4 preview)

The cron + webhook code talk to email exclusively through one trait:

```rust
#[async_trait]
pub trait NotificationSender: Send + Sync + std::fmt::Debug {
    async fn send(
        &self,
        recipient_email: &str,
        kind: NotificationKind,
    ) -> Result<(), NotificationError>;
}
```

The `Arc<dyn NotificationSender>` field on `AppState` is constructed
by `crate::state::build_notification_sender()`. Phase 4 will:

1. Add an `EmailConfig` block to `datashuttle.yaml` (SMTP host/user/
   pass or AWS SES region).
2. Replace the body of `build_notification_sender` to branch on the
   config and return either `LogNotificationSender` (default) or a
   real `SmtpNotificationSender` / `SesNotificationSender`.

No call sites change. Tests use the in-tree `MockNotificationSender`
helper (see `crates/datashuttle-api/src/notifications.rs::test_support`)
which records every send for assertion. The same helper is used by the
signup-approval flow
([SAAS-PRODUCTION-PLAN §4.2](../../../../.planning/SAAS-PRODUCTION-PLAN.md#42-registerverify-flow)).

---

## Audit trail

Every state-machine transition that changes user-visible billing state
emits an entry through `crate::audit::audit_log!`:

| Action | Trigger |
|---|---|
| `billing.dunning.suspended` | 3rd consecutive payment failure |
| `billing.dunning.downgraded` | 14d in `PastDue`, tier flipped back to `community` |
| `billing.upgrade` | Webhook flips tier from Community → paid |
| `billing.cancel` | Explicit cancel via portal (`customer.subscription.deleted`) |

These flow into `audit.jsonl` and the in-memory ring buffer the same
way as every other admin action — operators can query them via
`GET /api/v1/audit/events?action=billing.*`.

Signup approval / rejection events
(`admin.signup.approved`, `admin.signup.rejected`) are emitted by the
admin console API, not by this module — see
[ADMIN-CONSOLE-PLAN §9.4](../../../../.planning/ADMIN-CONSOLE-PLAN.md#94-audit-events).

---

## Migration notes

`billing_customers` carries a `has_payment_method` boolean used by the
upgrade and dunning paths to decide whether a tier flip is allowed
without a Checkout redirect:

```sql
-- 011_billing_has_payment_method.sql
ALTER TABLE billing_customers
    ADD COLUMN IF NOT EXISTS has_payment_method BOOLEAN NOT NULL DEFAULT false;
```

The `IF NOT EXISTS` guard makes this idempotent on existing live
databases. No backfill is required: legacy rows default to `false` and
the webhook flips the column to `true` on the first successful
`payment_method.attached` event.

The legacy `last_trial_reminder_at` column (introduced while the
14-day Team trial was in scope) is no longer populated. A follow-up
migration will drop the column once the dunning smoke path no longer
reads it — tracked separately.

## Daily Stripe DPU usage reporting (#555 task 3.5)

The dunning state machine drives customer lifecycle; the **usage
reporter** is the second leg — it pushes per-tenant DPU consumption to
Stripe so customers are billed correctly for what they used.

> **OSS / self-managed users:** This entire section is opt-in and
> SaaS-only. If `state.stripe_client` is `None` (the default for any
> deployment that hasn't explicitly wired a Stripe client), the
> reporter is never spawned and no DPU data leaves the process.

### Per-tenant segmentation

`DpuMeter` exposes two methods used by the reporter:

- `snapshot_per_tenant() -> HashMap<String, u64>` — non-destructive
  read of every tenant's accumulated DPU. The system bucket
  (`SYSTEM_TENANT_BUCKET = "__system__"`) holds usage that couldn't
  be attributed to a paying tenant and is **never** reported.
- `reset_tenant(tenant_id) -> u64` — atomically swap a tenant's
  bucket back to zero and return the previous value. Called by the
  reporter only after Stripe acknowledges the usage record.

Call sites that have a `tenant_id` (e.g. the pipeline manager, since
`PipelineRecord.tenant_id` is populated on tenant-scoped pipelines)
should use the `record_*_for_tenant` variants on `DpuCounters`.
Anything that doesn't know the tenant — system metrics, infra-level
ingest — leaves the per-tenant map alone and only updates the global
counters that drive quota / license enforcement.

### Daily reporter cron

When `AppState::stripe_client` is set, the constructor spawns a
background task (see
`crates/datashuttle-api/src/billing/usage_reporter.rs`) that runs
once per `interval_secs` (24h by default).

For each non-zero, non-`__system__` tenant bucket, the cron:

1. Looks up the matching `BillingCustomer` by `tenant_id` via
   `BillingRepository::get_customer_by_tenant`.
2. Skips the tenant if the customer record is missing or has no
   `subscription_item_id` (logged at `warn!` level). Community-tier
   tenants have no `subscription_item_id` and are skipped by design —
   the 10,000 DPU/month grant is a local quota, not a Stripe line item.
3. Calls `StripeClient::report_usage(subscription_item_id, dpu, ts)`
   with the current Unix timestamp.
4. **On success only:** resets the tenant bucket and emits a
   `billing.usage_reported` audit event.
5. On failure: logs at `warn!` and leaves the bucket intact for the
   next tick to retry.

### Idempotency

`report_usage` posts to Stripe with `action=set` (not `increment`),
so re-reporting the same total on a retry is a safe no-op — Stripe
overwrites the day's quantity rather than stacking it. This means a
crash between two cron ticks results in the **next** tick reporting
the cumulative total, not double-billing.

### Crash-recovery limitation

`DpuMeter`'s per-tenant bucket lives in process memory. If the API
server crashes or restarts between the last successful Stripe report
and the next cron tick, all DPU accumulated in the interim is lost.

> **Mitigation track:** persist per-tenant DPU totals to Postgres so
> the reporter can resume from a checkpoint after restart. Tracked
> as `TODO(#555 task 3.5 follow-up)` in
> `crates/datashuttle-license/src/metering.rs`.

### Disabling or changing the cadence

The reporter is opt-in via `AppState::stripe_client`. To disable it
on a node that already has Stripe wired (e.g. for staging), set
`state.stripe_client = None` before construction or before the
cron-spawn line.

To change the cadence without rebuilding (useful for staging
verification), set the `DS_BILLING_USAGE_REPORT_INTERVAL_SECS`
environment variable. Values are seconds; absence or any unparseable
value falls back to the 24h default. The variable is intentionally
optional — no new mandatory env vars are introduced by this feature
(per the on-prem hard invariant).

```sh
# Report every 5 minutes for staging end-to-end verification.
DS_BILLING_USAGE_REPORT_INTERVAL_SECS=300 datashuttle serve
```

### Testing

Two test surfaces cover the reporter:

- **Unit tests in `crates/datashuttle-license/src/metering.rs`** —
  `per_tenant_*` cases prove `DpuCounters` segments tenants
  correctly, accumulates DPU across all three source types, and that
  `reset_tenant` returns the pre-reset value.
- **Wiremock integration tests in
  `crates/datashuttle-api/src/billing/usage_reporter.rs`** —
  exercise the OSS no-op path, the happy path with bucket reset, the
  failure path with bucket preservation, and the
  no-`subscription_item_id` skip path. Run with:

```sh
cargo test -p datashuttle-api --lib billing::usage_reporter
```
