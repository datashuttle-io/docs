# Documentation screenshots

These 12 PNGs are referenced by `docs/book/src/operations/dashboards.md`,
`setup-wizard.md`, and `billing.md`. The files in this directory today
are **placeholders** — solid-color 1440×900 images so the mdBook build
and the link-check pass without 404s.

## Replacing with real screenshots

Per the original spec ([#636](https://github.com/evgenyestepanov-star/datashuttle/issues/636)):

| File | What it should show |
|---|---|
| `shuttle-overview.png` | Grafana dashboard at 1440×900 — shuttles panel populated |
| `cdc-lag.png` | Grafana CDC lag chart, p50/p95/p99 lines visible |
| `resource-pools.png` | Grafana per-tenant pool utilisation |
| `node-health.png` | Grafana cluster nodes pane, all green |
| `connector-errors.png` | Grafana per-connector error-rate panel |
| `iceberg-commits.png` | Grafana iceberg commit-frequency panel |
| `setup-step1.png`–`setup-step4.png` | Setup wizard each step |
| `usage-dashboard.png` | UI usage page, populated 30-day chart, shuttle >50% quota |
| `billing-page.png` | UI billing page, trialing customer + populated invoice list |

Capture with the UI running locally (or against a staging cluster) at
**1440×900** browser viewport. Save the new PNGs over the placeholders
and commit; the placeholder generator is in
`scripts/generate-placeholder-screenshots.py` if you ever need to
restore a missing file before a real capture.

## Regenerating placeholders

```bash
python3 scripts/generate-placeholder-screenshots.py
```
