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
3. **Trials** — start a 14-day Pro trial on signup, warn the user 24h
   before it expires, and either charge them (if a payment method is
   on file) or downgrade them to Free.

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
signup tier=pro  ──►  status=Trialing, trial_ends_at = now + 14d
                      audit: <none — visible via /api/v1/billing/customers>

T-24h  sweep_trials_ending_soon cron tick
       └─► TrialEndingSoon mail (sent at most once per trial via
           billing_customers.last_trial_reminder_at)

T+0    sweep_expired_trials cron tick
       ├─ has_payment_method = true  → status = Active, tier = pro
       │                              → TrialExpired { downgraded:false }
       └─ has_payment_method = false → status = Active, tier = free
                                       trial_ends_at = NULL
                                       → TrialExpired { downgraded:true }
       audit: billing.trial.expired
```

Constants live in `crates/datashuttle-api/src/billing/trial.rs`:

| Constant | Value | Purpose |
|---|---|---|
| `TRIAL_DAYS` | `14` | Pro-tier trial length |
| `TRIAL_ENDING_SOON_WINDOW_HOURS` | `24` | Reminder window |

### Idempotency

The hourly cron will see "ends in <24h" for ~24 ticks, but each
customer should only get one reminder. We dedup using
`billing_customers.last_trial_reminder_at`: once the column is set
within the current trial window we skip subsequent ticks. The check
considers the trial's start time (`trial_ends_at - 14d`) so a
re-trial after a downgrade-and-resub still triggers a fresh ping.

### Free / Enterprise tiers

* **Free** signups create a `BillingCustomer` with `status=Active`
  and no `trial_ends_at`. This is necessary so the
  [QuotaGuard](../operations/billing.md) middleware (Phase 3 task 3.2)
  can find a tier row.
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
