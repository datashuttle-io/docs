# DataShuttle Cloud — Quotas & Tiers

> **OSS / on-prem note.** Single-tenant deployments without a billing
> record are unaffected by everything on this page. The runtime quota
> guard is a no-op when there is no `AuthContext`, no `tenant_id`
> claim, or no `BillingStore` record for the caller's tenant. You can
> verify this any time with `scripts/check-onprem-compat.sh --quick`.

DataShuttle Cloud bills usage in **DPUs** (DataShuttle Processing
Units). Each tier reserves an amount of DPUs every month and (paid
tiers only) grants a small *overage allowance* on top, after which the
runtime starts rejecting mutating requests with `HTTP 429`.

## Tier definitions

| Tier         | DPUs included | Overage allowance | What `QuotaGuard` does                                         |
| ------------ | -------------:| -----------------:| -------------------------------------------------------------- |
| `free`       |        10 000 |                 0 | rejects with `429` immediately past included DPUs              |
| `pro`        |       500 000 |           100 000 | rejects with `429` past `dpu_included + overage_allowance`     |
| `enterprise` |    *unlimited*|     *unlimited*   | always passes — never enforced at the edge                     |

Plans are defined in `crate::billing::default_plans()` and can be
overridden by an operator. A custom plan with a tier name not in the
table above falls back to the customer record's stored
`dpu_included`.

## When the guard runs

`QuotaGuard` is an axum [`FromRequestParts`] extractor wired into:

* `POST /api/v1/pipelines` — pipeline creation
* `POST /api/v1/sql` — SQL execution (CREATE PIPELINE, ALTER, etc.)

Read-only endpoints (`GET /pipelines`, `/health`, `/metrics`, the auth
endpoints, the billing portal itself) **do not** evaluate the guard.

The guard runs *before* the request body is parsed, so a rejected
request never touches shared state.

## HTTP responses

All rejection bodies use the same JSON shape:

```jsonc
{
  "error": "string — safe to render in a UI",
  "code":  "quota_exceeded | subscription_past_due | subscription_canceled",
  "tier":  "free | pro | enterprise",          // optional
  "billing_url": "https://app.example.com/..." // optional, only when configured
}
```

### `429 Too Many Requests` — `quota_exceeded`

Returned when `current_usage_for_tenant >= dpu_included + overage_allowance`.

```json
{
  "error": "DPU quota exceeded for tier 'pro'. Upgrade your plan or wait for the next billing period.",
  "code": "quota_exceeded",
  "tier": "pro",
  "billing_url": "https://app.datashuttle.ai/billing/upgrade?tenant=acme"
}
```

### `402 Payment Required` — `subscription_past_due`

Returned when the customer's billing status is `past_due`. The user
must update their payment method.

```json
{
  "error": "Subscription is past due. Update your payment method to keep using DataShuttle.",
  "code": "subscription_past_due",
  "tier": "pro",
  "billing_url": "https://app.datashuttle.ai/billing/upgrade?tenant=acme"
}
```

### `402 Payment Required` — `subscription_canceled`

Returned when the subscription has been canceled. Read-only access is
preserved by the auth layer; only mutating endpoints reject.

```json
{
  "error": "Subscription has been canceled. Contact support to reactivate.",
  "code": "subscription_canceled",
  "tier": "pro",
  "billing_url": "https://app.datashuttle.ai/billing/upgrade?tenant=acme"
}
```

### How does this differ from `401 Unauthorized`?

| Status | Meaning                                                                       |
| ------ | ----------------------------------------------------------------------------- |
| `401`  | The request had no valid credentials. Fix: log in / refresh the token.        |
| `402`  | Authentication is fine but the customer's subscription is in a failed state.  |
| `429`  | Authentication and subscription are fine but the tenant has hit its DPU cap.  |

## Configuring `billing_url`

Set the optional `billing` block in `datashuttle.yaml`:

```yaml
billing:
  billing_portal_url: "https://app.datashuttle.ai/billing"
  # Optional — defaults to "{portal}/upgrade?tenant={tenant_id}".
  upgrade_url_template: "{portal}/upgrade?tenant={tenant_id}"
```

When `billing_portal_url` is unset, the runtime omits `billing_url`
from rejection bodies entirely. This is the OSS / on-prem default and
ensures we never advertise a portal that doesn't exist.

## Related

* `crate::billing::QuotaGuard` — the extractor itself
* `crate::billing::default_plans()` — tier definitions
* [Operations → Billing](../operations/billing.md) — Stripe webhook
  handling, dunning, invoice export
* [Operations → Licensing](../operations/licensing.md) — license file
  format, feature gating, DPU metering
