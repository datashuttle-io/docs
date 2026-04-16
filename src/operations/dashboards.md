# Grafana Dashboards

DataShuttle ships six starter Grafana dashboards plus a bundled Prometheus
alert rule set. They live at:

```
deploy/grafana/dashboards/
  01-pipeline-overview.json
  02-cdc-lag.json
  03-resource-pools.json
  04-node-health.json
  05-connector-errors.json
  06-iceberg-commits.json
deploy/prometheus/alerts.yaml
```

All dashboards use a templated `datasource` variable so you can point them at
your own Prometheus instance without editing the JSON. Each dashboard is
tagged `datashuttle` and `cross-grade-19` for easy filtering.

## Loading dashboards

### Option 1 — Helm ConfigMap (recommended on Kubernetes)

The Helm chart ships a ConfigMap that the Grafana sidecar
([`kiwigrid/k8s-sidecar`](https://github.com/kiwigrid/k8s-sidecar), also used
by the `kube-prometheus-stack` chart) will auto-import. It's **opt-in**:

```yaml
# values.yaml
grafana:
  dashboards:
    enabled: true
```

Then:

```sh
helm upgrade --install datashuttle ./datashuttle-chart.tgz \
  --set grafana.dashboards.enabled=true
```

The ConfigMap is labelled `grafana_dashboard: "1"` — the sidecar default
selector. Override with `grafana.dashboards.labels` / `.annotations` if you
use a different sidecar configuration (e.g. to pin a folder).

### Option 2 — Manual import

In Grafana: **Dashboards → Import → Upload JSON file**, and upload each
`*.json` from `deploy/grafana/dashboards/`. Pick your Prometheus data source
when prompted.

### Option 3 — Provisioning files

Copy the JSONs into your Grafana provisioning directory
(`/etc/grafana/provisioning/dashboards/`) and add a provider file pointing
at the folder. See the [Grafana provisioning docs][prov] for details.

[prov]: https://grafana.com/docs/grafana/latest/administration/provisioning/#dashboards

## Loading alert rules

The bundled alerts at `deploy/prometheus/alerts.yaml` cover:

- **Pipelines** — lag warning/critical, error-rate, stuck pipeline, freshness
  SLA violations, queue-backlog.
- **Nodes** — no-nodes-reporting, node-CPU, node-memory.
- **Iceberg** — pending files, flush p95 latency, commits stopped.
- **System** — sync-errors surge, avg-lag critical, compaction backlog,
  cooperative-snapshot pending.

### With the Helm chart

```yaml
# values.yaml
prometheusAlerts:
  enabled: true
  kind: PrometheusRule   # or ConfigMap if you don't have the operator CRD
```

### Standalone Prometheus

```yaml
# prometheus.yaml
rule_files:
  - /etc/prometheus/datashuttle-alerts.yaml
```

Copy `deploy/prometheus/alerts.yaml` to that path and reload Prometheus.

## Dashboard reference

| # | Dashboard | Key metrics |
|---|-----------|-------------|
| 01 | Pipeline overview | `datashuttle_active_pipelines`, `datashuttle_pipeline_rows_total`, `datashuttle_pipeline_errors_total`, `datashuttle_pipeline_cdc_lag_seconds` |
| 02 | CDC lag & freshness | `datashuttle_pipeline_cdc_lag_seconds`, `datashuttle_pipeline_freshness_seconds`, `datashuttle_pipeline_freshness_violation` |
| 03 | Resource pools | `datashuttle_pipeline_queue_depth`, `datashuttle_pipelines_per_node`, `datashuttle_cooperative_snapshot_pending`, `datashuttle_compaction_pending_files` |
| 04 | Node health | `datashuttle_cluster_nodes`, `datashuttle_node_cpu_usage_percent`, `datashuttle_node_memory_usage_bytes` |
| 05 | Connector errors | `datashuttle_pipeline_errors_total`, `datashuttle_sync_errors_total`, `datashuttle_transform_errors_total` |
| 06 | Iceberg commits | `datashuttle_iceberg_commits_total`, `datashuttle_iceberg_pending_files`, `datashuttle_iceberg_pending_bytes`, `datashuttle_iceberg_flush_duration_seconds` |

Panels marked `TODO:` in their description reference metrics that are not yet
emitted (e.g. `datashuttle_pipeline_state`, `datashuttle_fencing_token_total`,
`datashuttle_iceberg_orphan_files_total`). Those panels will populate as soon
as the emitters land — no dashboard change required.

## Screenshots

Screenshots live in `docs/book/src/operations/images/dashboards/` once the
monitoring stack is live in staging.

- `pipeline-overview.png` — _placeholder_
- `cdc-lag.png` — _placeholder_
- `resource-pools.png` — _placeholder_
- `node-health.png` — _placeholder_
- `connector-errors.png` — _placeholder_
- `iceberg-commits.png` — _placeholder_

## See also

- [Monitoring & Alerting](./monitoring.md) — metric catalogue.
- [Development → Test environment](../development/test-environment.md) —
  the bundled Prometheus + Grafana profile runs a local copy of these
  dashboards for development.
