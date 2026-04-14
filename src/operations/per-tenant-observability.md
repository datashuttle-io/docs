# Per-tenant observability

DataShuttle ships with request-scoped structured logging and
per-tenant Prometheus metrics (Phase 6 task 6.4 of the SaaS
production plan, #558). Both are always on; the per-tenant metrics
only populate when at least one tenant has authenticated, so on-prem
single-tenant deployments see no overhead.

## Request-scoped logging

Every HTTP request receives:

| Span field    | Source                                                       |
| ------------- | ------------------------------------------------------------ |
| `request_id`  | `x-request-id` header if supplied, otherwise UUIDv4          |
| `method`      | HTTP verb                                                    |
| `uri`         | Request-target                                               |
| `user_id`     | `AuthContext.user_id` (set once auth middleware runs)        |
| `tenant_id`   | `TenantContext.tenant_id` (set once membership is verified)  |
| `org_id`      | `TenantContext.org_id`                                       |
| `auth_method` | `AuthContext.auth_method` (`oidc`, `api_key`, `basic`, etc.) |
| `status`      | Recorded after the handler returns                           |
| `latency_ms`  | Recorded after the handler returns                           |

The same `x-request-id` is reflected back on the response so clients,
load balancers, and upstream gateways can correlate their logs with
the server's `http_request` span.

The tracing span is wired into the OpenTelemetry bootstrap from
Phase 6.5 (#566), so if you enable `observability.traces.exporter:
otlp` in `datashuttle.yaml` the same span flows into Jaeger/Tempo.

### Example PromQL and log queries

Jaeger/Tempo: filter `service.name = datashuttle-api` by
`tenant_id = $TENANT`.

Loki / JSON log search:

```logql
{app="datashuttle-api"} | json | tenant_id="acme" | __error__=""
```

## Per-tenant Prometheus metrics

| Metric                                            | Type      | Labels                     | Description                                                     |
| ------------------------------------------------- | --------- | -------------------------- | --------------------------------------------------------------- |
| `datashuttle_tenant_requests_total`               | Counter   | `tenant, status, method`   | HTTP requests per tenant; `status` is a class (`2xx`, `4xx`, …) |
| `datashuttle_tenant_request_duration_seconds`     | Histogram | `tenant, status`           | Request latency; buckets span 1 ms to 30 s                      |
| `datashuttle_tenant_dpu_rate`                     | Gauge     | `tenant`                   | DPUs/sec, sampled every 60 s by the background cron             |
| `datashuttle_tenant_billing_status`               | Gauge     | `tenant, status`           | 1 on the row matching the customer's status, 0 on the others   |

### Example PromQL queries

Top 10 tenants by DPU rate right now:

```promql
topk(10, datashuttle_tenant_dpu_rate)
```

Tenants burning more than 75% of their included DPU allotment (assuming
`dpu_allotment{tenant}` is published from your billing layer):

```promql
(datashuttle_tenant_dpu_rate * 86400 * 30)
  / on(tenant) dpu_allotment > 0.75
```

Error rate per tenant:

```promql
sum by (tenant) (rate(datashuttle_tenant_requests_total{status=~"4xx|5xx"}[5m]))
```

Count of tenants in each billing state:

```promql
sum by (status) (datashuttle_tenant_billing_status == 1)
```

### Dashboards

The repository ships
`deploy/grafana/dashboards/07-per-tenant-view.json` (mirrored into
the Helm chart's `dashboards/` ConfigMap). Import it into Grafana to
get pre-built panels for request rate, DPU rate, billing-status pie,
and 4xx/5xx error table.

## Cardinality considerations

Per-tenant metrics are **by design** unbounded in `tenant` cardinality.
Planning capacity matters:

- The soft cap is **10,000 distinct tenants per metric family**. When
  a fresh tenant label pushes the total past that threshold we emit
  a one-shot `warn!` log so operators can react before Prometheus
  ingestion slows down.
- The DPU-rate gauge eviction strategy evicts a tenant from
  `datashuttle_tenant_dpu_rate` after **5 consecutive samples with
  zero delta AND no new DPU activity** (i.e. 5 minutes of complete
  idleness). This keeps the gauge from pinning at stale values for
  churned-out tenants.
- The request counter and the billing-status gauge are **never**
  evicted automatically — their values are part of the compliance
  audit trail (invoice reconciliation reads the historical
  counters). Use Prometheus
  [`metric_relabel_configs`](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#metric_relabel_configs)
  if you need to drop decommissioned tenants:

  ```yaml
  metric_relabel_configs:
    - source_labels: [tenant]
      regex: "deleted-.*"
      action: drop
  ```

- If you run at the **50k+ tenants** scale, consider sharding the
  Prometheus tier — e.g. a small `prometheus-tenant` instance that
  scrapes just `datashuttle_tenant_*` series, fronted by Thanos for
  long-term storage.

## On-prem behaviour

The metric families are registered unconditionally but stay empty
when no tenant has authenticated. The DPU-rate and billing-status
cron runs on production `AppState::new_single_node` and
`new_cluster`; test harnesses (`AppState::new_in_memory`) skip it
so test runs don't leak tokio tasks. This matches the existing
pattern for `spawn_billing_cron` and keeps
`scripts/check-onprem-compat.sh --quick` green.

## See also

- [Monitoring & Alerting](./monitoring.md) — the aggregate fleet-wide
  dashboard.
- [Billing & Dunning](../cloud/billing.md) — where the
  `BillingStatus` values come from.
- [Licensing](./licensing.md) — how DPUs are counted in the first
  place.
