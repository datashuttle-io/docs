# Troubleshooting

Common issues and how to resolve them.

## Pipeline stuck in ERROR state

```bash
# Check what went wrong
datashuttle pipeline status <name>
datashuttle pipeline logs <name>

# Check dead letters for rows that failed
datashuttle deadletter list <name>
```

### Common causes

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `connection refused` | Source database unreachable | Check network, firewall, credentials |
| `schema evolution blocked` | Schema change with `schema_evolution = 'strict'` | Approve the change or switch to `compatible` |
| `dead letter threshold exceeded` | Too many rows failing transform | Review dead letters, fix source data or transform |
| `sync position lost` | Source pruned its change log | Drop and recreate the pipeline (triggers fresh load) |
| `permission denied` | User lacks required privileges | Grant the appropriate permissions (see connector docs) |

### Resolve and resume

```bash
# After fixing the root cause, resume the pipeline
datashuttle sql -e "RESUME PIPELINE <name>"

# Or replay dead letters after fixing the issue
datashuttle deadletter replay <name>
```

## High sync latency

```bash
datashuttle pipeline status <name>   # check lag_seconds
```

### Remediation

1. **Increase parallelism** — more workers for the initial load:

    ```sql
    -- Drop and recreate with higher parallelism
    DROP PIPELINE orders_sync;
    CREATE PIPELINE orders_sync
      SOURCE pg_prod TABLE orders
      TARGET warehouse.raw
      WITH (parallelism = 8);
    ```

2. **Increase commit interval** — batch more rows per commit to reduce commit overhead:

    ```sql
    -- Larger batches = fewer commits = higher throughput
    WITH (commit_interval = '60 seconds')
    ```

3. **Check source database load** — heavy write load on the source increases sync latency

4. **Scale horizontally** — add more DataShuttle nodes to distribute pipelines

## Connection test fails

```bash
curl http://localhost:8080/api/v1/connections/<name>/status
```

| Error | Check |
|-------|-------|
| `connection refused` | Hostname, port, firewall |
| `authentication failed` | Username, password |
| `database does not exist` | Database name |
| `SSL required` | Add SSL properties to connection |

## DataShuttle won't start

```bash
# Check logs
journalctl -u datashuttle -f           # systemd
docker logs datashuttle                  # Docker

# Common issues
datashuttle start --config datashuttle.yaml --log-level debug
```

| Error | Fix |
|-------|-----|
| `port already in use` | Another process on :8080/:9090 |
| `cannot reach catalog` | Check `storage.catalog_uri` in config |
| `cannot reach object storage` | Check S3 endpoint and credentials |
| `invalid config` | Validate YAML syntax |

## Node not joining cluster

```bash
datashuttle status   # check node count
```

Ensure:
- Port 7946 (TCP + UDP) is open between nodes
- `--seed-nodes` points to a running node
- All nodes use the same catalog URI
