# Pipelines

Pipelines are the core unit of work. A pipeline connects a source to an Iceberg target and keeps them in sync.

## CREATE PIPELINE

```sql
CREATE PIPELINE <name>
  SOURCE <connection> TABLE <table> [, <table>, ...]
  TARGET <namespace>
  [SCHEDULE <schedule>]
  [WITH (
    <option> = '<value>',
    ...
  )];
```

For file sources:

```sql
CREATE PIPELINE <name>
  SOURCE <connection> PATH '<s3-path>'
  TARGET <namespace>
  [SCHEDULE <schedule>]
  [WITH (
    <option> = '<value>',
    ...
  )];
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `name` | Yes | Unique pipeline identifier |
| `SOURCE` | Yes | Connection name + table(s) or path |
| `TARGET` | Yes | Iceberg namespace (e.g., `warehouse.raw`) |
| `SCHEDULE` | No | Sync schedule (see below) |
| `WITH` | No | Pipeline options (see below) |

### Schedule

DataShuttle uses a freshness-based sync model. Users specify how often they want data synchronized; the system automatically selects the optimal mechanism (CDC, polling, file scanning) based on connector capabilities.

| Schedule | Behavior |
|----------|----------|
| `continuous` (default) | Keep data as fresh as the source allows. Uses native change tracking (WAL/binlog) when available. |
| `EVERY '<interval>'` | Sync at specified interval (e.g., `EVERY '15 minutes'`, `EVERY '24 hours'`). |

The initial snapshot is always automatic on first pipeline start — it is not a user-selectable mode.

Legacy `mode` values (`CDC`, `SNAPSHOT_THEN_CDC`, `SNAPSHOT_ONLY`, `APPEND`) are still accepted for backward compatibility and mapped to the equivalent schedule internally.

### Pipeline options

| Option | Default | Values | Description |
|--------|---------|--------|-------------|
| `schedule` | `continuous` | `continuous`, `EVERY '<duration>'` | Sync schedule (alternative to `SCHEDULE` clause) |
| `commit_interval` | `30 seconds` | Duration string | How often to commit to Iceberg |
| `delete_mode` | `deletion_vectors` | `deletion_vectors`, `copy_on_write` | How deletes are handled |
| `schema_evolution` | `compatible` | `compatible`, `strict` | Auto-apply schema changes or pause |
| `iceberg_format_version` | `3` | `2`, `3` | Iceberg table format version |
| `batch_size` | `10000` | Integer | Rows per micro-batch |
| `parallelism` | `4` | Integer | Parallel snapshot workers |
| `file_pattern` | `*` | Glob | File pattern for S3 sources |
| `csv_header` | `true` | Boolean | CSV files have a header row |
| `csv_delimiter` | `,` | Character | CSV field delimiter |

## Examples

```sql
-- Continuous CDC pipeline (default schedule)
CREATE PIPELINE orders_sync
  SOURCE pg_prod TABLE orders
  TARGET warehouse.raw;

-- Explicit continuous schedule with options
CREATE PIPELINE orders_sync
  SOURCE pg_prod TABLE orders
  TARGET warehouse.raw
  SCHEDULE continuous
  WITH (
    commit_interval = '15 seconds',
    delete_mode = 'deletion_vectors',
    schema_evolution = 'compatible'
  );

-- Multi-table with tuned options
CREATE PIPELINE crm_full
  SOURCE pg_prod TABLE orders, customers, payments, products
  TARGET warehouse.crm
  WITH (
    commit_interval = '15 seconds',
    delete_mode = 'deletion_vectors',
    schema_evolution = 'compatible',
    parallelism = 8
  );

-- Periodic sync (every 24 hours)
CREATE PIPELINE historical_load
  SOURCE pg_prod TABLE legacy_orders
  TARGET warehouse.archive
  SCHEDULE EVERY '24 hours';

-- S3 file ingestion
CREATE PIPELINE event_files
  SOURCE s3_lake PATH 's3://events/2026/'
  TARGET warehouse.raw
  SCHEDULE EVERY '5 minutes'
  WITH (file_pattern = '*.parquet');
```

## DROP PIPELINE

```sql
DROP PIPELINE <name>;
```

Drops the pipeline, releases the replication slot (for database sources), and removes the pipeline definition from the catalog. Does **not** delete the Iceberg table or its data.
