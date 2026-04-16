# Billing, Dunning & Trials (SaaS)

> **OSS users:** the billing webhook handler is compiled in every build,
> but the dunning + trial cron only runs when the API server is built
> with the `saas` cargo feature. Default OSS deployments seed an
> in-memory `BillingRepository`, never spawn the cron, and never need a
> Stripe key. You can ignore the rest of this page.

DataShuttle Cloud's billing layer covers three responsibilities:

1. **Webhook ingest** — turn Stripe `invoice.*` and
   `customer.subscription.*` events into mutations on the
   `billing_customers` / `billing_invoices` tables.
2. **Dunning** — escalate failed payments from a polite reminder to a
   tenant suspend to (eventually) a soft-delete + cancel.
3. **Trials** — start a 14-day Team trial on signup, warn the user 24h
   before it expires, and either charge them (if a payment method is
   on file) or downgrade them to Community.

All three pieces share the [`crate::notifications::NotificationSender`]
trait. In the default build it's a [`LogNotificationSender`] stub that
just writes a `tracing::info!` line; **Phase 4** swaps in the
SMTP/SES-backed implementation. No new mandatory env vars.

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
T+14d sweep_past_due cron flip → status = Canceled
                              → soft_delete_tenant (30d grace)
                              → SubscriptionCanceled mail
                              → audit: billing.dunning.canceled
```

Constants live in `crates/datashuttle-api/src/billing/dunning.rs`:

| Constant | Value | Purpose |
|---|---|---|
| `MAX_PAYMENT_RETRIES` | `3` | Failures before suspend |
| `PAST_DUE_GRACE_DAYS` | `14` | Days in `PastDue` before cancel |

A successful `invoice.paid` at any point calls
[`crate::billing::dunning::on_payment_succeeded`], which:

* resets `payment_failure_count` to 0,
* flips status back to `Active`,
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

## Trial lifecycle

```
signup tier=team ──►  status=Trialing, trial_ends_at = now + 14d
                      audit: <none — visible via /api/v1/billing/customers>

T-24h  sweep_trials_ending_soon cron tick
       └─► TrialEndingSoon mail (sent at most once per trial via
           billing_customers.last_trial_reminder_at)

T+0    sweep_expired_trials cron tick
       ├─ has_payment_method = true  → status = Active, tier = team
       │                              → TrialExpired { downgraded:false }
       └─ has_payment_method = false → status = Active, tier = community
                                       trial_ends_at = NULL
                                       → TrialExpired { downgraded:true }
       audit: billing.trial.expired
```

Constants live in `crates/datashuttle-api/src/billing/trial.rs`:

| Constant | Value | Purpose |
|---|---|---|
| `TRIAL_DAYS` | `14` | Team-tier trial length |
| `TRIAL_ENDING_SOON_WINDOW_HOURS` | `24` | Reminder window |

### Idempotency

The hourly cron will see "ends in <24h" for ~24 ticks, but each
customer should only get one reminder. We dedup using
`billing_customers.last_trial_reminder_at`: once the column is set
within the current trial window we skip subsequent ticks. The check
considers the trial's start time (`trial_ends_at - 14d`) so a
re-trial after a downgrade-and-resub still triggers a fresh ping.

### Community / Business / Enterprise tiers

* **Community** signups create a `BillingCustomer` with `status=Active`
  and no `trial_ends_at`. This is necessary so the
  [QuotaGuard](../operations/billing.md) middleware (Phase 3 task 3.2)
  can find a tier row.
* **Business** signups route through the same trial path as Team —
  14-day trial, then downgrade to Community on expiry without a
  payment method.
* **Enterprise** signups skip `start_trial` entirely — Sales sets up
  the customer record manually via the admin API.

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
which records every send for assertion.

---

## Audit trail

Every state-machine transition that changes user-visible billing state
emits an entry through `crate::audit::audit_log!`:

| Action | Trigger |
|---|---|
| `billing.dunning.suspended` | 3rd consecutive payment failure |
| `billing.dunning.canceled` | 14d in `PastDue` |
| `billing.trial.expired` | Trial expiry sweep |

These flow into `audit.jsonl` and the in-memory ring buffer the same
way as every other admin action — operators can query them via
`GET /api/v1/audit/events?action=billing.*`.

---

## Migration notes

Phase 3 task 3.4 introduces two new columns on `billing_customers`:

```sql
-- 011_billing_trial_reminders.sql
ALTER TABLE billing_customers
    ADD COLUMN IF NOT EXISTS last_trial_reminder_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS has_payment_method BOOLEAN NOT NULL DEFAULT false;
```

The `IF NOT EXISTS` guard makes this idempotent on existing live
databases. No backfill is required: legacy rows default to `NULL` /
`false` and the cron treats them as "no reminder yet sent / no card
on file" — the safest defaults.

## Daily Stripe DPU usage reporting (#555 task 3.5)

The dunning + trial state machines drive customer lifecycle; the
**usage reporter** is the third leg — it pushes per-tenant DPU
consumption to Stripe so customers are billed correctly for what
they used.

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
   `subscription_item_id` (logged at `warn!` level).
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
