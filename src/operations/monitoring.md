# Monitoring & Alerting

## Prometheus metrics

DataShuttle exposes a `/metrics` endpoint on the metrics port (default `:9090`) in Prometheus exposition format.

### Key metrics

```
# Cluster
datashuttle_active_pipelines 42
datashuttle_cluster_nodes 3
datashuttle_uptime_seconds 86400

# Per-pipeline
datashuttle_pipeline_rows_total{pipeline="orders_sync",table="orders"} 1523456
datashuttle_pipeline_commits_total{pipeline="orders_sync"} 4521
datashuttle_pipeline_errors_total{pipeline="orders_sync"} 3

# HPA scaling signals
datashuttle_pipeline_queue_depth 0
datashuttle_avg_sync_lag_seconds 4.200
datashuttle_pipelines_per_node{node="node-1"} 12
datashuttle_cooperative_snapshot_pending 0
datashuttle_node_cpu_utilization_percent{node="node-1"} 45.2
datashuttle_node_memory_utilization_percent{node="node-1"} 62.8
```

### Prometheus scrape config

```yaml
# prometheus.yml
scrape_configs:
  - job_name: datashuttle
    static_configs:
      - targets: ['datashuttle:9090']
    metrics_path: /metrics
```

For Kubernetes with the Prometheus operator, use the ServiceMonitor:

```bash
# Installed via Helm:
helm install datashuttle deploy/helm/datashuttle \
  --set serviceMonitor.enabled=true

# Or standalone:
kubectl apply -f deploy/k8s/servicemonitor.yaml
```

### Alerting rules

Pre-built alerting rules for Prometheus operator:

```bash
# Installed via Helm:
helm install datashuttle deploy/helm/datashuttle \
  --set prometheusRule.enabled=true

# Or standalone:
kubectl apply -f deploy/k8s/prometheusrule.yaml
```

Included alerts:

| Alert | Threshold | Severity |
|-------|-----------|----------|
| DataShuttleSyncLagWarning | avg lag > 5 min for 5 min | warning |
| DataShuttleSyncLagCritical | avg lag > 30 min for 5 min | critical |
| DataShuttlePipelineErrorRate | error rate > 1% for 5 min | warning |
| DataShuttlePipelineQueueBacklog | queue depth > 0 for 10 min | warning |
| DataShuttleNodeDown | 0 nodes for 1 min | critical |
| DataShuttleNodeHighCPU | CPU > 90% for 5 min | warning |

### Grafana dashboard

Import the pre-built dashboard from `deploy/k8s/grafana-dashboard.json`. Includes 14 panels:
- Active pipelines, cluster nodes, avg sync lag, queue depth, uptime (stats)
- Rows ingested rate, commit rate, error rate (timeseries)
- Pipelines per node (bar gauge)
- Node CPU/memory utilization (timeseries)

### HPA auto-scaling

DataShuttle exports metrics designed for Kubernetes HPA auto-scaling. With `prometheus-adapter`, these drive scale-up and scale-down:

**Scale-up triggers (any):**
- `datashuttle_pipeline_queue_depth > 0` — pipelines waiting for a node
- `datashuttle_avg_sync_lag_seconds > 60` — lag too high
- `datashuttle_pipelines_per_node > 10` — nodes overloaded
- CPU > 80%

**Scale-down triggers (all must be true for 5 min):**
- Queue depth = 0
- Avg lag < threshold
- Pipelines per node < 5
- CPU < 40%

See `deploy/k8s/hpa.yaml` for the HPA manifest.

## Resource pool monitoring

The monitoring API (`GET /api/v1/monitoring/stats`) includes per-pool stats:

```json
{
  "resource_pools": [
    {
      "name": "critical",
      "mode": "dedicated",
      "priority": "high",
      "active_pipelines": 4,
      "max_pipelines": 10,
      "active_snapshots": 1,
      "max_snapshots": 3,
      "node_count": 2
    }
  ]
}
```

The Web UI monitoring dashboard shows pool utilization cards with progress bars.

## Webhooks

Configure webhook notifications in `datashuttle.yaml`:

```yaml
webhooks:
  - url: https://hooks.slack.com/services/T00/B00/xxx
    events: [pipeline.error, pipeline.schema.changed]
  - url: https://pagerduty.com/integrate/events
    events: [pipeline.error, pipeline.lag.critical]
```

### Event types

| Event | Trigger |
|-------|---------|
| `pipeline.created` | New pipeline created |
| `pipeline.paused` | Pipeline paused (user or circuit breaker) |
| `pipeline.resumed` | Pipeline resumed |
| `pipeline.dropped` | Pipeline dropped |
| `pipeline.commit` | Successful Iceberg commit |
| `pipeline.error` | Pipeline error (auto-paused) |
| `pipeline.schema.changed` | Source schema change detected |
| `pipeline.lag.critical` | Sync latency exceeds threshold |

## Web UI

Open `http://<any-node>:8080` in a browser. Every node serves the full UI.

The dashboard shows:
- **Cluster Overview** — node count, total rows/sec, active pipelines
- **Pipeline List** — all pipelines with status, lag, rows/sec, error count
- **Pipeline Detail** — per-table breakdown, schema, pause/resume controls
- **Data Lineage** — interactive DAG: source → pipeline → Iceberg tables → downstream views
- **Monitoring** — aggregate metrics, per-pipeline stats, resource pool utilization
- **Settings** — catalog, storage, auth, pipeline defaults, connector registry, resource pools
