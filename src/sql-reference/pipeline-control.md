# Pipeline Control

SQL statements for managing running pipelines.

## PAUSE PIPELINE

```sql
PAUSE PIPELINE <name>;
```

Pauses a running pipeline. The replication slot (PostgreSQL) or binlog position (MySQL) is held — no data is lost. The pipeline moves to `Paused` state.

**Example:**

```bash
datashuttle sql -e "PAUSE PIPELINE orders_sync"
```

## RESUME PIPELINE

```sql
RESUME PIPELINE <name>;
```

Resumes a paused pipeline from the last checkpointed position. The pipeline moves from `Paused` back to `Running`.

**Example:**

```bash
datashuttle sql -e "RESUME PIPELINE orders_sync"
```

## ALTER PIPELINE (planned)

```sql
ALTER PIPELINE <name>
  SET (
    commit_interval = '15 seconds',
    parallelism = 8
  );
```

> **Note:** `ALTER PIPELINE` is planned for a future release. Currently, to change pipeline options, drop and recreate the pipeline.

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

## Re-snapshot

Not a SQL statement — available via CLI and REST API:

```bash
# CLI
datashuttle pipeline resnapshot orders_sync

# REST API
curl -X POST http://localhost:8080/api/v1/pipelines/orders_sync/resnapshot
```

This drops existing Iceberg data, takes a fresh snapshot from the source, and resumes CDC.
