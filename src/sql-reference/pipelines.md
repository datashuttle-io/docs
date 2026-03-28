# Pipelines

Pipelines are the core unit of work. A pipeline connects a source to an Iceberg target and keeps them in sync.

## CREATE PIPELINE

```sql
CREATE PIPELINE <name>
  SOURCE <connection> TABLE <table> [, <table>, ...]
  TARGET <namespace>
  WITH (
    <option> = '<value>',
    ...
  );
```

For file sources:

```sql
CREATE PIPELINE <name>
  SOURCE <connection> PATH '<s3-path>'
  TARGET <namespace>
  WITH (
    <option> = '<value>',
    ...
  );
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `name` | Yes | Unique pipeline identifier |
| `SOURCE` | Yes | Connection name + table(s) or path |
| `TARGET` | Yes | Iceberg namespace (e.g., `warehouse.raw`) |
| `WITH` | No | Pipeline options (see below) |

### Pipeline options

| Option | Default | Values | Description |
|--------|---------|--------|-------------|
| `mode` | `SNAPSHOT_THEN_CDC` | `CDC`, `SNAPSHOT_THEN_CDC`, `SNAPSHOT_ONLY`, `APPEND` | Replication mode |
| `commit_interval` | `30 seconds` | Duration string | How often to commit to Iceberg |
| `delete_mode` | `deletion_vectors` | `deletion_vectors`, `copy_on_write` | How deletes are handled |
| `schema_evolution` | `compatible` | `compatible`, `strict` | Auto-apply schema changes or pause |
| `parallelism` | `4` | Integer | Parallel snapshot workers |
| `file_pattern` | `*` | Glob | File pattern for S3 sources |
| `csv_header` | `true` | Boolean | CSV files have a header row |
| `csv_delimiter` | `,` | Character | CSV field delimiter |

### Mode descriptions

| Mode | Behavior |
|------|----------|
| `SNAPSHOT_THEN_CDC` | Take initial snapshot, then switch to continuous CDC |
| `CDC` | Skip snapshot, start from current WAL/binlog position |
| `SNAPSHOT_ONLY` | Take a one-time snapshot, then stop |
| `APPEND` | File sources only — ingest new files periodically |

## Examples

```sql
-- Basic CDC pipeline
CREATE PIPELINE orders_sync
  SOURCE pg_prod TABLE orders
  TARGET warehouse.raw
  WITH (mode = 'CDC');

-- Multi-table with tuned options
CREATE PIPELINE crm_full
  SOURCE pg_prod TABLE orders, customers, payments, products
  TARGET warehouse.crm
  WITH (
    mode = 'SNAPSHOT_THEN_CDC',
    commit_interval = '15 seconds',
    delete_mode = 'deletion_vectors',
    schema_evolution = 'compatible',
    parallelism = 8
  );

-- Snapshot only (one-time load)
CREATE PIPELINE historical_load
  SOURCE pg_prod TABLE legacy_orders
  TARGET warehouse.archive
  WITH (mode = 'SNAPSHOT_ONLY');

-- S3 file ingestion
CREATE PIPELINE event_files
  SOURCE s3_lake PATH 's3://events/2026/'
  TARGET warehouse.raw
  WITH (
    mode = 'APPEND',
    file_pattern = '*.parquet',
    commit_interval = '5 minutes'
  );
```

## DROP PIPELINE

```sql
DROP PIPELINE <name>;
```

Drops the pipeline, releases the replication slot (for database sources), and removes the pipeline definition from the catalog. Does **not** delete the Iceberg table or its data.
