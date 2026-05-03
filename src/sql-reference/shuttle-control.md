# Shuttle Control

SQL statements for managing running shuttles.

## PAUSE SHUTTLE

```sql
PAUSE SHUTTLE <name>;
```

Pauses a running shuttle. The sync position is held — no data is lost. The shuttle moves to `Paused` state.

**Example:**

```bash
datashuttle sql -e "PAUSE SHUTTLE orders_sync"
```

## RESUME SHUTTLE

```sql
RESUME SHUTTLE <name>;
```

Resumes a paused shuttle from the last checkpointed position. The shuttle transitions back to `Running`.

**Example:**

```bash
datashuttle sql -e "RESUME SHUTTLE orders_sync"
```

## ALTER SHUTTLE

```sql
ALTER SHUTTLE <name>
  SET (
    commit_interval = '15 seconds',
    parallelism = 8
  );
```

Supported properties for `SET`: `commit_interval`, `schedule`, `batch_size`, `parallelism`, `resource_pool`, `error_strategy`.

Example:

```bash
datashuttle sql -e "ALTER SHUTTLE orders_sync SET (commit_interval = '10 seconds')"
```

Alternatively, use the REST API:

```bash
curl -X PUT http://localhost:8080/api/v1/shuttles/orders_sync \
  -H 'Content-Type: application/json' \
  -d '{"sql": "ALTER SHUTTLE orders_sync SET (commit_interval = '\''10 seconds'\'')"}'
```

## Using the CLI

All SQL statements can be executed via the CLI:

```bash
# Execute inline SQL
datashuttle sql -e "PAUSE SHUTTLE orders_sync"

# Execute from a file
datashuttle sql -f shuttles/pause-all.sql

# Interactive SQL console
datashuttle sql
```

## Using the REST API

```bash
# Pause
curl -X POST http://localhost:8080/api/v1/shuttles/orders_sync/pause

# Resume
curl -X POST http://localhost:8080/api/v1/shuttles/orders_sync/resume
```

## Reload from source

Not a SQL statement — available via CLI and REST API:

```bash
# CLI
datashuttle shuttle resnapshot orders_sync

# REST API
curl -X POST http://localhost:8080/api/v1/shuttles/orders_sync/resnapshot
```

This re-loads all data from the source, then resumes continuous sync.
