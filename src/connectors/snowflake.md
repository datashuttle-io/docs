# Snowflake Connector

Sync Snowflake tables to Iceberg using Snowflake Streams for change tracking or watermark-based incremental reads.

## Sync model

- **Continuous / periodic with Snowflake Streams**: Captures inserts, updates, and deletes from source tables. Latency is in the minutes range — Snowflake Tasks are polled periodically.
- **Watermark incremental**: For append-only tables, queries only rows newer than the last checkpoint. Set `watermark_column` in the shuttle options.

## Prerequisites

- Snowflake account with a SQL Warehouse (Serverless or Standard)
- User with `SELECT` privilege on target tables and `USAGE` on the warehouse, database, and schema

For Streams + Tasks mode, the user also needs:
```sql
GRANT CREATE STREAM ON SCHEMA public TO datashuttle;
GRANT CREATE TASK ON SCHEMA public TO datashuttle;
```

## CREATE CONNECTION

```sql
CREATE CONNECTION sf_prod
  TYPE SNOWFLAKE
  PROPERTIES (
    account = 'myorg-myaccount',
    username = 'datashuttle',
    password = SECRET 'vault://secrets/sf_pass',
    warehouse = 'COMPUTE_WH',
    database = 'ANALYTICS',
    schema = 'PUBLIC',
    role = 'SYSADMIN'
  );
```

### Connection properties

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `account` | Yes | — | Snowflake account identifier (`org-account`) |
| `username` | Yes | — | Snowflake user |
| `password` | Yes | — | Password |
| `warehouse` | Yes | — | Compute warehouse |
| `database` | Yes | — | Database name |
| `schema` | No | `PUBLIC` | Schema name |
| `role` | No | `SYSADMIN` | Role |

## CREATE SHUTTLE

```sql
-- Continuous sync via Snowflake Streams
CREATE SHUTTLE sf_orders
  SOURCE sf_prod TABLE orders
  TARGET warehouse.raw
  SCHEDULE EVERY '10 minutes';

-- Watermark-based for append-only tables
CREATE SHUTTLE sf_events
  SOURCE sf_prod TABLE events
  TARGET warehouse.raw
  SCHEDULE EVERY '15 minutes'
  WITH (watermark_column = 'EVENT_TIMESTAMP');
```

## Type mapping

| Snowflake | Arrow | Iceberg |
|-----------|-------|---------|
| `BOOLEAN` | Boolean | `boolean` |
| `BYTEINT` / `TINYINT` | Int8 | `int` |
| `SMALLINT` | Int16 | `int` |
| `INT` / `INTEGER` / `MEDIUMINT` | Int32 | `int` |
| `BIGINT` | Int64 | `long` |
| `FLOAT` / `FLOAT4` / `REAL` | Float32 | `float` |
| `FLOAT8` / `DOUBLE` / `DOUBLE PRECISION` | Float64 | `double` |
| `NUMBER(p,s)` / `DECIMAL(p,s)` / `NUMERIC(p,s)` | Decimal128(p,s) | `decimal(p,s)` |
| `VARCHAR` / `TEXT` / `STRING` / `CHAR` | Utf8 | `string` |
| `BINARY` / `VARBINARY` | Binary | `binary` |
| `DATE` | Date32 | `date` |
| `TIME` | Time64(μs) | `time` |
| `TIMESTAMP_LTZ` / `TIMESTAMP_TZ` | Timestamp(μs, UTC) | `timestamptz` |
| `TIMESTAMP_NTZ` | Timestamp(μs, None) | `timestamp` |
| `VARIANT` / `OBJECT` / `ARRAY` | Utf8 | `string` (JSON) |

## Limitations

- **Snowflake Streams consume credits** — each stream scan bills against the compute warehouse. Monitor credit usage for high-frequency shuttles.
- `VARIANT`, `OBJECT`, and `ARRAY` columns are captured as JSON strings. Native V3 VARIANT mapping is planned.
- Schema changes (column additions) are auto-applied in `compatible` evolution mode. Column drops and type narrowing require manual intervention.
- `TIMESTAMP_TZ` fractional seconds are truncated to microseconds.
