# Amazon Redshift Connector

Sync Amazon Redshift tables to Iceberg using watermark-based incremental reads or full snapshot. Redshift speaks the PostgreSQL wire protocol, so DataShuttle reuses the `tokio-postgres` client.

## Sync model

Redshift has no WAL or logical-replication equivalent, so DataShuttle uses **watermark-based incremental reads**: on each scheduled run it queries only rows where `watermark_column > last_checkpoint_value`. The checkpoint is persisted so the next run continues from where the previous left off.

For one-shot full loads (e.g. dimension tables that are rebuilt nightly), omit `watermark_column` and the connector will paginate via primary key (or `LIMIT/OFFSET` if no PK exists).

## Prerequisites

- Redshift cluster reachable from the DataShuttle deployment
- A user with `SELECT` privilege on the target tables and `USAGE` on the schema
- A monotonically increasing column to use as the watermark (e.g. `updated_at`, an identity bigint)

## CREATE CONNECTION

```sql
CREATE CONNECTION redshift_prod
  TYPE REDSHIFT
  PROPERTIES (
    host = 'my-cluster.abc123.us-east-1.redshift.amazonaws.com',
    port = '5439',
    database = 'analytics',
    username = 'datashuttle',
    password = SECRET 'vault://secrets/redshift_pass',
    watermark_column = 'updated_at'
  );
```

### Connection properties

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `host` | Yes | — | Redshift cluster endpoint |
| `port` | No | `5439` | Port |
| `database` | Yes | — | Database name |
| `username` | Yes | — | Username |
| `password` | Yes | — | Password |
| `schema` | No | `public` | Default schema for discovery |
| `watermark_column` | No | — | Column for incremental reads |
| `ssl_mode` | No | — | `disable` / `prefer` / `require` |

## CREATE PIPELINE

```sql
-- Incremental sync (recommended)
CREATE PIPELINE redshift_events
  SOURCE redshift_prod TABLE public.events
  TARGET warehouse.raw
  SCHEDULE EVERY '15 minutes'
  WITH (watermark_column = 'updated_at');

-- Full snapshot, periodic
CREATE PIPELINE redshift_dim
  SOURCE redshift_prod TABLE public.dim_product
  TARGET warehouse.raw
  SCHEDULE EVERY '1 hour';
```

## Type mapping

| Redshift | Arrow | Iceberg |
|----------|-------|---------|
| `SMALLINT` / `INT2` | Int16 | `int` |
| `INTEGER` / `INT` / `INT4` | Int32 | `int` |
| `BIGINT` / `INT8` | Int64 | `long` |
| `REAL` / `FLOAT4` | Float32 | `float` |
| `DOUBLE PRECISION` / `FLOAT8` | Float64 | `double` |
| `DECIMAL(p,s)` / `NUMERIC(p,s)` | Utf8 | `decimal(p,s)` |
| `BOOLEAN` | Boolean | `boolean` |
| `CHAR` / `VARCHAR` / `TEXT` | Utf8 | `string` |
| `VARBYTE` / `VARBINARY` | Binary | `binary` |
| `DATE` | Date32 | `date` |
| `TIME` / `TIMETZ` | Utf8 | `string` |
| `TIMESTAMP` | Timestamp(µs) | `timestamp` |
| `TIMESTAMPTZ` | Timestamp(µs, UTC) | `timestamptz` |
| `SUPER` | Utf8 (JSON text) | `string` |
| `GEOMETRY` / `GEOGRAPHY` | Binary (WKB) | `binary` |
| `HLLSKETCH` | Binary | `binary` |
| `UUID` | Utf8 | `string` |

`SUPER` (Redshift's semi-structured JSON-like type) is preserved as JSON text. Once Iceberg V3 `Variant` is generally available a future revision will surface `SUPER` natively.

## Limitations

- **No CDC.** Redshift exposes no row-level change feed. Use `watermark_column` for incremental ingestion.
- **No parallel reads.** Redshift is a managed MPP, but cluster-internal segments are not directly addressable from the leader-node JDBC/wire endpoint. Snapshots run sequentially against the leader.
- **No schema evolution detection.** ALTER TABLE on the source must be handled manually.
- **`UNLOAD TO s3://` is not yet wired up.** Large snapshots fetch row-by-row over the wire protocol. This is fine for tables up to a few hundred million rows; very large dimension or fact tables should use a manual `UNLOAD` + `cloud_storage` connector workflow until the dedicated unload path lands.
