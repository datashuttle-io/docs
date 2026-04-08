# Pipelines

Pipelines are the core unit of work. A pipeline connects a source to an Iceberg target and keeps them in sync.

## CREATE PIPELINE

```sql
CREATE PIPELINE <name>
  SOURCE <connection> TABLE <table> [, <table>, ...]
  TARGET <namespace>
  [PARTITION BY (<partition-field>, ...)]
  [CLUSTER BY (<sort-field>, ...)]
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

### `PARTITION BY (...)` and `CLUSTER BY (...)`

Two top-level clauses control the physical layout of the destination
Iceberg table. See the [Partitioning & Clustering chapter](../concepts/partitioning-clustering.md)
for the full reference and performance guidance.

Both clauses accept a comma-separated list of field expressions:

```text
field          := <transform>(<args>)        — explicit transform
                | <column>                    — identity (default)
                | <expr> AS <name>            — partition only, alias
                | <expr> ASC|DESC             — cluster only, direction
                | <expr> ASC|DESC NULLS FIRST|LAST   — cluster only, with null ordering

transform      := identity | bucket | truncate | year | month | day | hour
args           := <column>                    — year/month/day/hour
                | <N>, <column>               — bucket
                | <W>, <column>               — truncate
```

Examples:

```sql
PARTITION BY (
  day(event_ts),
  bucket(16, user_id) AS user_bucket
)
CLUSTER BY (
  event_ts DESC NULLS FIRST,
  user_id ASC
)
```

Each transform validates that its source column exists in the table
schema and has a compatible type. `year/month/day/hour` require a date
or timestamp column; `truncate` requires int or string; `bucket` accepts
int, string, date, or timestamp.

Sort orders can be **modified on a live pipeline** without rewriting
data — DataShuttle uses Iceberg's sort-order evolution to push the new
order onto existing tables. Partition specs can only be set on new
tables; see the partitioning chapter for details.

### Schedule

DataShuttle uses a freshness-based sync model. Users specify how often they want data synchronized; the system automatically selects the optimal sync mechanism based on connector capabilities.

| Schedule | Behavior |
|----------|----------|
| `continuous` (default) | Keep data as fresh as the source allows. Achievable latency depends on the source type. |
| `EVERY '<interval>'` | Sync at specified interval (e.g., `EVERY '15 minutes'`, `EVERY '24 hours'`). |

The initial load is always automatic on first pipeline start — it is not a user-selectable mode.

Legacy `mode` values are still accepted for backward compatibility and mapped to the equivalent schedule internally.

### Pipeline options

| Option | Default | Values | Description |
|--------|---------|--------|-------------|
| `schedule` | `continuous` | `continuous`, `EVERY '<duration>'` | Sync schedule (alternative to `SCHEDULE` clause) |
| `commit_interval` | `30 seconds` | Duration string | How often to commit to Iceberg |
| `delete_mode` | `deletion_vectors` | `deletion_vectors`, `copy_on_write` | How deletes are handled |
| `schema_evolution` | `compatible` | `compatible`, `strict`, `none` | Auto-apply schema changes or pause |
| `iceberg_format_version` | `3` | `2`, `3` | Iceberg table format version |
| `batch_size` | `10000` | Integer | Rows per micro-batch |
| `parallelism` | `4` | Integer | Parallel workers for initial load |
| `resource_pool` | `default` | Pool name string | Resource pool for workload isolation |
| `watermark_column` | — | Column name | Incremental read cursor (ClickHouse, BigQuery, Vertica, etc.) |
| `error_strategy` | `dead_letter` | `dead_letter`, `skip`, `fail` | What to do with malformed / errored rows |
| `max_retries` | `5` | Integer | Max connector error retries before circuit-break |
| `retry_backoff` | `exponential` | `exponential`, `fixed` | Retry backoff strategy |
| `max_backoff` | `5 minutes` | Duration string | Cap for exponential backoff |
| `circuit_breaker_threshold` | `10` | Integer | Consecutive failures to trip circuit breaker (`0` = disabled) |
| `skip_initial_snapshot` | `false` | Boolean | Skip bulk load and start CDC from current position |
| `add_metadata_columns` | `true` | Boolean | Inject `_ds_ingested_at`, `_ds_source_table`, `_ds_operation` columns |
| `file_pattern` | `*` | Glob | File pattern for S3 / file sources |
| `csv_header` | `true` | Boolean | CSV files have a header row |
| `csv_delimiter` | `,` | Character | CSV field delimiter |
| `commit_batch_files` | `1000` | Integer | Snapshot phase: max staged parquet files before an Iceberg commit ([details](../concepts/iceberg-commit-batching.md)) |
| `commit_batch_bytes` | `256 MB` | Byte size | Snapshot phase: max staged bytes before an Iceberg commit |
| `commit_batch_interval` | `30 seconds` | Duration | Snapshot phase: max age of the oldest staged file before an Iceberg commit |
| `cdc_commit_batch_files` | `100` | Integer | CDC phase: same as `commit_batch_files` but tighter for streaming |
| `cdc_commit_batch_bytes` | `64 MB` | Byte size | CDC phase: same as `commit_batch_bytes` |
| `cdc_commit_batch_interval` | `5 seconds` | Duration | CDC phase: same as `commit_batch_interval` |
| `write_distribution_mode` | `none` | `none` \| `hash` | Iceberg `write.distribution-mode` for partitioned tables ([details](../concepts/partitioning-clustering.md#distribution-mode)) |
| `target_file_rows` | `5000000` | Integer | File-size targeting: loose row cap on the row buffer (memory-safety guard, not the primary file-size knob — see `target_file_bytes`) ([details](../concepts/iceberg-commit-batching.md#file-size-targeting-460)) |
| `target_file_bytes` | `64 MB` | Byte size | File-size targeting: in-memory buffer size before a cut |
| `target_file_interval` | `60 seconds` | Duration | File-size targeting: max age of oldest buffered row before a force-cut |
| `parquet_row_group_size` | `128 MB` | Byte size | Intra-file parquet row-group size target |

## Examples

```sql
-- Continuous sync (default schedule)
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

-- Partitioned + clustered events table
CREATE PIPELINE clickstream
  SOURCE pg_prod TABLE events
  TARGET warehouse.analytics
  PARTITION BY (day(event_ts), bucket(32, user_id))
  CLUSTER BY (event_ts DESC NULLS FIRST, user_id ASC)
  SCHEDULE continuous;

-- Periodic sync (every 24 hours)
CREATE PIPELINE historical_load
  SOURCE pg_prod TABLE legacy_orders
  TARGET warehouse.archive
  SCHEDULE EVERY '24 hours';

-- Pipeline in a dedicated resource pool
CREATE PIPELINE critical_orders
  SOURCE pg_prod TABLE orders
  TARGET warehouse.raw
  WITH (resource_pool = 'critical');

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

Drops the pipeline and removes the pipeline definition from the catalog. Does **not** delete the Iceberg table or its data.
