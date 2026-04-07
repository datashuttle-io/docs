# Vertica Connector

Sync Vertica tables to Iceberg using watermark-based incremental reads or full snapshot. Supports MPP parallel reads via direct Vertica node connections.

## Sync model

Vertica does not have native CDC. DataShuttle uses **watermark-based incremental reads**: on each scheduled run it queries only rows where `watermark_column > last_checkpoint_value`. The checkpoint is persisted so the next run continues from where the previous left off.

MPP parallel snapshot is supported: DataShuttle distributes the load across Vertica nodes using projections, bypassing the initiator bottleneck.

## Prerequisites

- Vertica 10+
- User with `SELECT` privilege on target tables and `USAGE` on the schema

## CREATE CONNECTION

```sql
CREATE CONNECTION vertica_prod
  TYPE VERTICA
  PROPERTIES (
    host = 'vertica-vip.internal',
    port = '5433',
    database = 'analytics',
    username = 'datashuttle',
    password = SECRET 'vault://secrets/vertica_pass',
    watermark_column = 'updated_at'
  );
```

### Connection properties

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `host` | Yes | — | Vertica host or VIP |
| `port` | No | `5433` | Port |
| `database` | Yes | — | Database name |
| `username` | Yes | — | Username |
| `password` | Yes | — | Password |
| `schema` | No | `public` | Default schema |
| `tls_mode` | No | — | `disable` / `require` / `verify-ca` / `verify-full` |
| `backup_server_node` | No | — | Failover hosts (comma-separated) |
| `watermark_column` | No | — | Column for incremental reads |

## CREATE PIPELINE

```sql
-- Incremental sync (recommended)
CREATE PIPELINE vertica_sales
  SOURCE vertica_prod TABLE public.fact_sales
  TARGET warehouse.raw
  SCHEDULE EVERY '15 minutes'
  WITH (watermark_column = 'updated_at');

-- Full snapshot, periodic
CREATE PIPELINE vertica_dim
  SOURCE vertica_prod TABLE public.dim_product
  TARGET warehouse.raw
  SCHEDULE EVERY '1 hour';
```

## Incremental reads

When `watermark_column` is configured, the pipeline:

1. Reads the last watermark value from its checkpoint
2. Queries `SELECT * FROM <table> WHERE <watermark_column> > '<last_value>' ORDER BY <watermark_column>`
3. Persists the maximum observed value after the run
4. The next run reads only newer rows

The watermark column must be monotonically increasing (e.g. `TIMESTAMPTZ`, `INTEGER`, `VARCHAR` ISO-8601 date).

## Type mapping

| Vertica | Arrow | Iceberg |
|---------|-------|---------|
| `INTEGER` / `INT` / `BIGINT` | Int64 | `long` |
| `SMALLINT` / `TINYINT` | Int16 | `int` |
| `FLOAT` / `REAL` | Float64 | `double` |
| `DECIMAL(p,s)` / `NUMERIC(p,s)` | Decimal128(p,s) | `decimal(p,s)` |
| `MONEY` | Decimal128(19,4) | `decimal(19,4)` |
| `BOOLEAN` | Boolean | `boolean` |
| `CHAR` / `VARCHAR` / `LONG VARCHAR` | Utf8 | `string` |
| `BINARY` / `VARBINARY` / `LONG VARBINARY` | Binary | `binary` |
| `DATE` | Date32 | `date` |
| `TIME` | Time64(μs) | `time` |
| `TIMETZ` | Utf8 | `string` |
| `TIMESTAMP` | Timestamp(μs, None) | `timestamp` |
| `TIMESTAMPTZ` | Timestamp(μs, UTC) | `timestamptz` |
| `INTERVAL` | Utf8 | `string` |
| `UUID` | Utf8 | `string` |

## Limitations

- No native CDC — deletes are not captured. Use a logical delete column (`is_deleted`) and filter downstream if needed.
- `ARRAY` and `SET` types are serialized as strings.
- `GEOGRAPHY` / `GEOMETRY` types require the Spatial package and are captured as WKB binary.
