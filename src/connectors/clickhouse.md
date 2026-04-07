# ClickHouse Connector

Read from ClickHouse tables and sync to Iceberg. Supports both standalone ClickHouse and distributed clusters (MPP parallel snapshot).

## Sync model

ClickHouse does not have a native CDC stream. DataShuttle uses **watermark-based incremental reads**: on each scheduled run, it reads only rows where `watermark_column > last_seen_value`. The last seen value is persisted in the checkpoint so the next run continues where the previous left off.

For `SCHEDULE continuous`, the pipeline re-runs at the minimum interval (~30 seconds by default). Use `SCHEDULE EVERY '<interval>'` for explicit control.

## Prerequisites

- ClickHouse 22.3+
- A user with `SELECT` privilege on the target tables
- A monotonically increasing column (e.g. `updated_at DATETIME`, `id UInt64`) for incremental reads

## CREATE CONNECTION

```sql
CREATE CONNECTION ch_prod
  TYPE CLICKHOUSE
  PROPERTIES (
    host = 'clickhouse.internal',
    port = '8123',
    database = 'analytics',
    username = 'default',
    password = SECRET 'vault://secrets/ch_pass',
    watermark_column = 'updated_at'
  );
```

For distributed (cluster) reads:

```sql
CREATE CONNECTION ch_cluster
  TYPE CLICKHOUSE
  PROPERTIES (
    host = 'ch-coordinator.internal',
    port = '8123',
    database = 'analytics',
    username = 'default',
    password = SECRET 'vault://secrets/ch_pass',
    cluster = 'prod_cluster',
    local_table_suffix = '_local',   -- suffix for shard-local tables; default: _local
    watermark_column = 'updated_at'
  );
```

### Connection properties

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `host` | Yes | — | ClickHouse host |
| `port` | No | `8123` | HTTP port |
| `database` | Yes | — | Database name |
| `username` | No | `default` | Username |
| `password` | No | — | Password |
| `protocol` | No | `http` | `http` or `native` |
| `cluster` | No | — | Cluster name for distributed (MPP) reads |
| `local_table_suffix` | No | `_local` | Suffix for shard-local table names when using distributed tables |
| `watermark_column` | No | — | Column for incremental reads (recommended) |
| `tls` | No | `false` | Enable TLS |

## CREATE PIPELINE

```sql
-- Incremental sync (recommended)
CREATE PIPELINE ch_events_sync
  SOURCE ch_prod TABLE events
  TARGET warehouse.raw
  SCHEDULE EVERY '5 minutes'
  WITH (
    watermark_column = 'updated_at'
  );
```

For distributed cluster tables, DataShuttle connects to each shard directly (bypassing the coordinator):

```sql
CREATE PIPELINE ch_cluster_sync
  SOURCE ch_cluster TABLE events
  TARGET warehouse.raw
  SCHEDULE EVERY '15 minutes';
```

## Incremental reads

When `watermark_column` is configured, the pipeline:

1. Reads the last seen watermark value from its checkpoint
2. Queries `SELECT * FROM table WHERE <watermark_column> > '<last_value>' ORDER BY <watermark_column>`
3. After completing the run, persists the maximum observed watermark value
4. The next run starts from that checkpoint

The watermark value is stored as a string to support any column type (datetime, integer, UUID).

**Important:** the watermark column must be monotonically increasing. Using a mutable column (e.g. a status field) will cause rows to be missed.

## MPP parallel snapshot

When `cluster` is set, DataShuttle queries `system.clusters` to discover shard topology and reads each shard directly:

- Each DataShuttle cluster node is assigned a subset of ClickHouse shards
- Reads go directly to shard-local tables (`<table><local_table_suffix>`)
- No coordinator bottleneck — throughput scales linearly with shard count

If a DataShuttle node has more nodes than ClickHouse shards, extra nodes are idle for this pipeline (correct behavior — no duplicate data).

## Type mapping

| ClickHouse | Arrow | Iceberg |
|-----------|-------|---------|
| `UInt8` / `Int8` | Int8 | `int` |
| `UInt16` / `Int16` | Int16 | `int` |
| `UInt32` / `Int32` | Int32 | `int` |
| `UInt64` / `Int64` | Int64 | `long` |
| `Float32` | Float32 | `float` |
| `Float64` | Float64 | `double` |
| `Decimal(p,s)` | Decimal128(p,s) | `decimal(p,s)` |
| `String` / `FixedString` | Utf8 | `string` |
| `Date` | Date32 | `date` |
| `DateTime` | Timestamp(s, None) | `timestamp` |
| `DateTime64` | Timestamp(ns/μs/ms, UTC) | `timestamptz` |
| `Boolean` | Boolean | `boolean` |
| `Nullable(T)` | nullable T | nullable T |
| `LowCardinality(T)` | T | T |
| `JSON` / `Object` | Utf8 | `string` |

## Limitations

- No native CDC — schema changes or deletes in the source are not automatically propagated. Use `SCHEDULE EVERY` with appropriate watermark to pick up new and updated rows.
- Deletes in ClickHouse (ReplacingMergeTree, deduplication) are not surfaced as CDC events. If your ClickHouse tables use logical deletes (a `is_deleted` flag or similar), filter accordingly with `WHERE` in the pipeline.
- `Array`, `Map`, and `Tuple` types are serialized as strings.
