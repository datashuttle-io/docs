# Monitoring & Alerting

## Prometheus metrics

DataShuttle exposes a `/metrics` endpoint on the metrics port (default `:9090`) in Prometheus exposition format.

### Key metrics

```
# Cluster
datashuttle_active_pipelines 42
datashuttle_cluster_nodes 3

# Per-pipeline
datashuttle_pipeline_rows_total{pipeline="orders_sync",table="orders"} 1523456
datashuttle_pipeline_commits_total{pipeline="orders_sync"} 4521
datashuttle_pipeline_errors_total{pipeline="orders_sync"} 3
datashuttle_pipeline_lag_seconds{pipeline="orders_sync"} 2.1
datashuttle_pipeline_bytes_total{pipeline="orders_sync"} 8392847234
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

For Kubernetes with the Prometheus operator, the StatefulSet annotations handle discovery automatically:

```yaml
annotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "9090"
```

### Recommended alerts

```yaml
# Alert on pipeline errors
- alert: DataShuttlePipelineError
  expr: increase(datashuttle_pipeline_errors_total[5m]) > 0
  labels:
    severity: warning
  annotations:
    summary: "Pipeline {{ $labels.pipeline }} has errors"

# Alert on high CDC lag
- alert: DataShuttleHighLag
  expr: datashuttle_pipeline_lag_seconds > 300
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Pipeline {{ $labels.pipeline }} lag is {{ $value }}s"
```

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
| `pipeline.lag.critical` | CDC lag exceeds threshold |

## Web UI

Open `http://<any-node>:8080` in a browser. Every node serves the full UI — no need to hit a specific node.

The dashboard shows:
- **Cluster Overview** — node count, total rows/sec, active pipelines
- **Pipeline List** — all pipelines with status, lag, rows/sec, error count
- **Pipeline Detail** — per-table breakdown, schema, pause/resume controls
