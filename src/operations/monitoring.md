# Monitoring & Alerting

## Prometheus metrics

DataShuttle exposes a `/metrics` endpoint on the metrics port (default `:9090`) in Prometheus exposition format.

### Key metrics

```
# Cluster
datashuttle_active_shuttles 42
datashuttle_cluster_nodes 3
datashuttle_uptime_seconds 86400

# Per-shuttle
datashuttle_shuttle_rows_total{shuttle="orders_sync",table="orders"} 1523456
datashuttle_shuttle_commits_total{shuttle="orders_sync"} 4521
datashuttle_shuttle_errors_total{shuttle="orders_sync"} 3

# HPA scaling signals
datashuttle_shuttle_queue_depth 0
datashuttle_avg_sync_lag_seconds 4.200
datashuttle_shuttles_per_node{node="node-1"} 12
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

For Kubernetes with the Prometheus operator, enable the ServiceMonitor via the Helm chart attached to every [GitHub Release](https://github.com/datashuttle-io/datashuttle/releases):

```bash
curl -fsSLO https://github.com/datashuttle-io/datashuttle/releases/latest/download/datashuttle-chart.tgz
helm install datashuttle ./datashuttle-chart.tgz \
  --set serviceMonitor.enabled=true
```

### Alerting rules

Pre-built alerting rules for the Prometheus operator ship in the same chart:

```bash
helm install datashuttle ./datashuttle-chart.tgz \
  --set prometheusRule.enabled=true
```

Included alerts:

| Alert | Threshold | Severity |
|-------|-----------|----------|
| DataShuttleSyncLagWarning | avg lag > 5 min for 5 min | warning |
| DataShuttleSyncLagCritical | avg lag > 30 min for 5 min | critical |
| DataShuttleShuttleErrorRate | error rate > 1% for 5 min | warning |
| DataShuttleShuttleQueueBacklog | queue depth > 0 for 10 min | warning |
| DataShuttleNodeDown | 0 nodes for 1 min | critical |
| DataShuttleNodeHighCPU | CPU > 90% for 5 min | warning |

### Grafana dashboard

The pre-built dashboard ships inside the Helm chart tarball (unpack it
and look under `datashuttle/dashboards/`). It includes 14 panels:
- Active shuttles, cluster nodes, avg sync lag, queue depth, uptime (stats)
- Rows ingested rate, commit rate, error rate (timeseries)
- Shuttles per node (bar gauge)
- Node CPU/memory utilization (timeseries)

### HPA auto-scaling

DataShuttle exports metrics designed for Kubernetes HPA auto-scaling. With `prometheus-adapter`, these drive scale-up and scale-down:

**Scale-up triggers (any):**
- `datashuttle_shuttle_queue_depth > 0` — shuttles waiting for a node
- `datashuttle_avg_sync_lag_seconds > 60` — lag too high
- `datashuttle_shuttles_per_node > 10` — nodes overloaded
- CPU > 80%

**Scale-down triggers (all must be true for 5 min):**
- Queue depth = 0
- Avg lag < threshold
- Shuttles per node < 5
- CPU < 40%

The Helm chart enables HPA out of the box with `--set autoscaling.enabled=true`.

## Resource pool monitoring

The monitoring API (`GET /api/v1/monitoring/stats`) includes per-pool stats:

```json
{
  "resource_pools": [
    {
      "name": "critical",
      "mode": "dedicated",
      "priority": "high",
      "active_shuttles": 4,
      "max_shuttles": 10,
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
    events: [shuttle.error, shuttle.schema.changed]
  - url: https://pagerduty.com/integrate/events
    events: [shuttle.error, shuttle.lag.critical]
```

### Event types

| Event | Trigger |
|-------|---------|
| `shuttle.created` | New shuttle created |
| `shuttle.paused` | Shuttle paused (user or circuit breaker) |
| `shuttle.resumed` | Shuttle resumed |
| `shuttle.dropped` | Shuttle dropped |
| `shuttle.commit` | Successful Iceberg commit |
| `shuttle.error` | Shuttle error (auto-paused) |
| `shuttle.schema.changed` | Source schema change detected |
| `shuttle.lag.critical` | Sync latency exceeds threshold |

## Web UI

Open `http://<any-node>:8080` in a browser. Every node serves the full UI.

The dashboard shows:
- **Cluster Overview** — node count, total rows/sec, active shuttles
- **Shuttle List** — all shuttles with status, lag, rows/sec, error count
- **Shuttle Detail** — per-table breakdown, schema, pause/resume controls
- **Data Lineage** — interactive DAG: source → shuttle → Iceberg tables → downstream views
- **Monitoring** — aggregate metrics, per-shuttle stats, resource pool utilization
- **Settings** — catalog, storage, auth, shuttle defaults, connector registry, resource pools
