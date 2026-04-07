# Pipeline Control

SQL statements for managing running pipelines.

## PAUSE PIPELINE

```sql
PAUSE PIPELINE <name>;
```

Pauses a running pipeline. The sync position is held — no data is lost. The pipeline moves to `Paused` state.

**Example:**

```bash
datashuttle sql -e "PAUSE PIPELINE orders_sync"
```

## RESUME PIPELINE

```sql
RESUME PIPELINE <name>;
```

Resumes a paused pipeline from the last checkpointed position. The pipeline transitions back to `Running`.

**Example:**

```bash
datashuttle sql -e "RESUME PIPELINE orders_sync"
```

## ALTER PIPELINE

```sql
ALTER PIPELINE <name>
  SET (
    commit_interval = '15 seconds',
    parallelism = 8
  );
```

Supported properties for `SET`: `commit_interval`, `schedule`, `batch_size`, `parallelism`, `resource_pool`, `error_strategy`.

Example:

```bash
datashuttle sql -e "ALTER PIPELINE orders_sync SET (commit_interval = '10 seconds')"
```

Alternatively, use the REST API:

```bash
curl -X PUT http://localhost:8080/api/v1/pipelines/orders_sync \
  -H 'Content-Type: application/json' \
  -d '{"sql": "ALTER PIPELINE orders_sync SET (commit_interval = '\''10 seconds'\'')"}'
```

## Using the CLI

All SQL statements can be executed via the CLI:

```bash
# Execute inline SQL
datashuttle sql -e "PAUSE PIPELINE orders_sync"

# Execute from a file
datashuttle sql -f pipelines/pause-all.sql

# Interactive SQL console
datashuttle sql
```

## Using the REST API

```bash
# Pause
curl -X POST http://localhost:8080/api/v1/pipelines/orders_sync/pause

# Resume
curl -X POST http://localhost:8080/api/v1/pipelines/orders_sync/resume
```

## Reload from source

Not a SQL statement — available via CLI and REST API:

```bash
# CLI
datashuttle pipeline resnapshot orders_sync

# REST API
curl -X POST http://localhost:8080/api/v1/pipelines/orders_sync/resnapshot
```

This re-loads all data from the source, then resumes continuous sync.
