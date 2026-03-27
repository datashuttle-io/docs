# Operations Guide

## Monitoring

### Prometheus Metrics

DataShuttle exposes a `/metrics` endpoint in Prometheus exposition format:

```
datashuttle_active_pipelines 42
datashuttle_cluster_nodes 3
datashuttle_pipeline_rows_total{pipeline="orders_sync",table="orders"} 1523456
datashuttle_pipeline_commits_total{pipeline="orders_sync"} 4521
datashuttle_pipeline_errors_total{pipeline="orders_sync"} 3
```

Scrape config:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: datashuttle
    static_configs:
      - targets: ['datashuttle:8080']
    metrics_path: /metrics
```

### Webhooks

Configure webhooks in `datashuttle.yaml`:

```yaml
webhooks:
  - url: https://hooks.slack.com/services/T00/B00/xxx
    events: [pipeline.error, pipeline.schema.changed]
  - url: https://pagerduty.com/integrate/events
    events: [pipeline.error, pipeline.lag.critical]
```

### Web UI

Open `http://<node>:8080` in a browser. Any node in the cluster serves the full UI.

## GitOps

### Pipeline-as-Code

Store pipelines as SQL files in Git:

```
pipelines/
├── crm/
│   ├── orders.sql
│   └── customers.sql
└── events/
    └── clickstream.sql
```

### Commands

```bash
# Validate without applying
datashuttle validate -f pipelines/

# Show what would change
datashuttle diff -f pipelines/

# Apply changes
datashuttle apply -f pipelines/

# Apply and remove orphaned pipelines
datashuttle apply -f pipelines/ --prune
```

## Cluster Operations

### Adding Nodes

```bash
datashuttle start --config datashuttle.yaml --seed-nodes node1:7946,node2:7946
```

New nodes join the gossip ring automatically. Pipelines rebalance within 30 seconds.

### Rolling Upgrades

1. Drain pipelines from the node: `datashuttle pipeline pause --owner node-3`
2. Upgrade the binary
3. Restart: `datashuttle start --config datashuttle.yaml`
4. Pipelines automatically rebalance back

### Backup & Recovery

Pipeline definitions are stored in the Iceberg catalog. CDC checkpoints are in Iceberg table properties. To recover:

1. Deploy new DataShuttle node(s)
2. Point to the same catalog and storage
3. Pipelines resume from last checkpoint automatically

## Troubleshooting

### Pipeline Stuck in ERROR State

```bash
datashuttle pipeline status <name>
datashuttle pipeline logs <name>
datashuttle deadletter list <name>
```

Common causes:
- Source database unreachable → check network/credentials
- Schema change with `schema_evolution = 'strict'` → approve the change
- Dead letter threshold exceeded → review and replay dead letters

### High CDC Lag

```bash
datashuttle pipeline status <name>  # check lag_seconds
```

Remediation:
- Increase `parallelism` in pipeline options
- Check source database load
- Increase `commit_interval` to batch more rows per commit
