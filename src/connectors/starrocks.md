# StarRocks Connector

Sync StarRocks tables to Iceberg using watermark-based incremental reads. Supports MPP parallel reads via direct Backend (BE) node connections.

## Sync model

StarRocks does not have native CDC. DataShuttle uses **watermark-based incremental reads**: on each scheduled run it queries only rows where `watermark_column > last_checkpoint_value`.

MPP parallel snapshot is supported when `be_hosts` is configured — DataShuttle reads directly from BE nodes, bypassing the FE (Frontend) bottleneck.

## Prerequisites

- StarRocks 3.0+
- User with `SELECT_PRIV` on target tables

## CREATE CONNECTION

```sql
CREATE CONNECTION sr_prod
  TYPE STARROCKS
  PROPERTIES (
    fe_host = 'sr-fe.internal',
    fe_query_port = '9030',
    fe_http_port = '8030',
    database = 'analytics',
    username = 'root',
    password = SECRET 'vault://secrets/sr_pass',
    watermark_column = 'updated_at'
  );
```

For MPP parallel reads:

```sql
CREATE CONNECTION sr_cluster
  TYPE STARROCKS
  PROPERTIES (
    fe_host = 'sr-fe.internal',
    fe_query_port = '9030',
    fe_http_port = '8030',
    database = 'analytics',
    username = 'root',
    password = SECRET 'vault://secrets/sr_pass',
    be_hosts = 'be1.internal,be2.internal,be3.internal',
    watermark_column = 'updated_at'
  );
```

### Connection properties

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `fe_host` | Yes | — | Frontend leader host |
| `fe_query_port` | No | `9030` | MySQL protocol port |
| `fe_http_port` | No | `8030` | HTTP port (Stream Load API) |
| `database` | Yes | — | Database name |
| `username` | Yes | — | Username |
| `password` | Yes | — | Password |
| `auth_type` | No | `password` | `password` or `ldap` |
| `be_hosts` | No | — | Backend hosts for direct reads (comma-separated) |
| `watermark_column` | No | — | Column for incremental reads |

## CREATE PIPELINE

```sql
CREATE PIPELINE sr_orders
  SOURCE sr_prod TABLE orders
  TARGET warehouse.raw
  SCHEDULE EVERY '10 minutes'
  WITH (watermark_column = 'updated_at');
```

## Type mapping

| StarRocks | Arrow | Iceberg |
|-----------|-------|---------|
| `BOOLEAN` | Boolean | `boolean` |
| `TINYINT` | Int8 | `int` |
| `SMALLINT` | Int16 | `int` |
| `INT` | Int32 | `int` |
| `BIGINT` | Int64 | `long` |
| `LARGEINT` | Decimal128(38,0) | `decimal(38,0)` |
| `FLOAT` | Float32 | `float` |
| `DOUBLE` | Float64 | `double` |
| `DECIMAL(p,s)` | Decimal128(p,s) | `decimal(p,s)` |
| `CHAR` / `VARCHAR` / `STRING` | Utf8 | `string` |
| `BINARY` / `VARBINARY` | Binary | `binary` |
| `DATE` | Date32 | `date` |
| `DATETIME` | Timestamp(μs, None) | `timestamp` |
| `JSON` | Utf8 | `string` |
| `ARRAY<T>` | Utf8 | `string` (serialized) |
| `MAP<K,V>` | Utf8 | `string` (serialized) |
| `STRUCT<...>` | Utf8 | `string` (serialized) |

## Limitations

- No native CDC — deletes are not captured.
- `ARRAY`, `MAP`, and `STRUCT` types are serialized as JSON strings.
- `LARGEINT` (128-bit) is mapped to `DECIMAL(38,0)` to avoid precision loss.
