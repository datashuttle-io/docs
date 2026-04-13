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
- Free tier: 10,000 DPU credit automatically applied
- Usage-based billing: DPU consumption reported at billing cycle end
- Overage: billed at next-tier-down rate
- Customer portal: manage payment methods, view invoices

## API Endpoints

```
GET  /api/v1/usage              — Current DPU usage and quota status
POST /api/v1/billing/webhook    — Stripe webhook handler
POST /api/v1/billing/portal     — Create Stripe Customer Portal session
```

## Quota Enforcement

- At 80% DPU usage: warning in logs
- At 100% (cloud): new pipeline creation blocked with upgrade message
- At 100% (self-hosted): warning only, 30-day grace period
- Airgapped: no enforcement, contractual compliance

## Usage Dashboard

The UI provides:
- DPU consumption gauge with percentage
- Breakdown by source type (batch, CDC, connector time)
- Daily usage chart
- Plan comparison and upgrade flow
- Billing portal access (Stripe)
