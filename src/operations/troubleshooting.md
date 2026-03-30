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
| `schema evolution blocked` | Schema change with `schema_evolution = 'strict'` | Approve the change or switch to `compatible` mode |
| `dead letter threshold exceeded` | Too many rows failing transform | Review dead letters, fix source data or transform |
| `replication slot does not exist` | Slot was dropped externally | Drop and recreate the pipeline |
| `permission denied` | CDC user lacks privileges | Grant `REPLICATION` (PG) or `REPLICATION SLAVE` (MySQL) |

### Resolve and resume

```bash
# After fixing the root cause, resume the pipeline
datashuttle sql -e "RESUME PIPELINE <name>"

# Or replay dead letters after fixing the issue
datashuttle deadletter replay <name>
```

## High CDC lag

```bash
datashuttle pipeline status <name>   # check lag_seconds
```

### Remediation

1. **Increase parallelism** — more snapshot/commit workers:

    ```sql
    -- Drop and recreate with higher parallelism
    DROP PIPELINE orders_sync;
    CREATE PIPELINE orders_sync
      SOURCE pg_prod TABLE orders
      TARGET warehouse.raw
    ```

2. **Increase commit interval** — batch more rows per commit to reduce commit overhead:

    ```sql
    -- Larger batches = fewer commits = higher throughput
    WITH (commit_interval = '60 seconds')
    ```

3. **Check source database load** — if the source is under heavy write load, CDC lag increases

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
