# CockroachDB Connector

Continuously sync CockroachDB tables to Iceberg using CockroachDB Changefeeds with sub-second latency.

## Sync model

CockroachDB Changefeeds push row-level change events (insert, update, delete) to DataShuttle via a webhook sink. DataShuttle receives the events and commits them to Iceberg at the configured `commit_interval`.

Two changefeed formats:
- `json` (default) — standard JSON format
- `avro` — Avro-encoded with Confluent Schema Registry

## Prerequisites

- CockroachDB 22.1+ (self-hosted or CockroachDB Cloud)
- `CHANGEFEED` privilege on target tables:
  ```sql
  GRANT CHANGEFEED ON TABLE orders TO datashuttle;
  ```

## CREATE CONNECTION

```sql
CREATE CONNECTION crdb_prod
  TYPE COCKROACHDB
  PROPERTIES (
    host = 'crdb.internal',
    port = '26257',
    database = 'defaultdb',
    username = 'root',
    password = SECRET 'vault://secrets/crdb_pass',
    sslmode = 'verify-full'
  );
```

For CockroachDB Cloud:

```sql
CREATE CONNECTION crdb_cloud
  TYPE COCKROACHDB
  PROPERTIES (
    host = 'free-tier14.aws-us-east-1.cockroachlabs.cloud',
    port = '26257',
    database = 'mydb',
    username = 'datashuttle',
    password = SECRET 'vault://secrets/crdb_pass',
    sslmode = 'verify-full',
    cluster_id = 'my-cluster-1234'
  );
```

### Connection properties

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `host` | Yes | — | CockroachDB hostname or load balancer |
| `port` | No | `26257` | SQL port |
| `database` | Yes | — | Database name |
| `username` | Yes | — | SQL user |
| `password` | Yes | — | Password |
| `sslmode` | No | `verify-full` | SSL mode |
| `cluster_id` | No | — | Cluster identifier (CockroachDB Cloud) |
| `changefeed_format` | No | `json` | `json` or `avro` |

## CREATE PIPELINE

```sql
CREATE PIPELINE crdb_orders
  SOURCE crdb_prod TABLE orders
  TARGET warehouse.raw
  SCHEDULE continuous
  WITH (commit_interval = '10 seconds');
```

## Type mapping

CockroachDB is wire-compatible with PostgreSQL. Full type mapping follows the [PostgreSQL connector](./postgresql.md).

| CockroachDB | Arrow | Iceberg |
|------------|-------|---------|
| `INT2` | Int16 | `int` |
| `INT4` | Int32 | `int` |
| `INT8` / `INT` | Int64 | `long` |
| `FLOAT4` | Float32 | `float` |
| `FLOAT8` / `FLOAT` | Float64 | `double` |
| `DECIMAL(p,s)` | Decimal128(p,s) | `decimal(p,s)` |
| `TEXT` / `VARCHAR` / `STRING` | Utf8 | `string` |
| `BOOL` | Boolean | `boolean` |
| `BYTES` | Binary | `binary` |
| `DATE` | Date32 | `date` |
| `TIME` | Time64(μs) | `time` |
| `TIMESTAMP` | Timestamp(μs, None) | `timestamp` |
| `TIMESTAMPTZ` | Timestamp(μs, UTC) | `timestamptz` |
| `UUID` | Utf8 | `string` |
| `JSONB` | Utf8 | `string` |
| `ARRAY` | Utf8 | `string` (JSON) |
| `INET` | Utf8 | `string` |

## Limitations

- Webhook-mode changefeeds (used by DataShuttle) are available on all CockroachDB tiers including free. Core changefeeds to external sinks (Kafka, cloud storage) require an Enterprise license.
- `ARRAY` types are serialized as JSON strings.
- Schema changes (e.g. `ADD COLUMN`) in CockroachDB are auto-detected and applied in `compatible` evolution mode. Column drops and renames require pipeline restart.
