# Databricks / Delta Lake Connector

> **Tier-2 connector.** This connector lives in the
> [`datashuttle-connectors-extra`](https://github.com/datashuttle-io/connectors-extra)
> repo and is **not** compiled into the default OSS build. To run it
> against a running OSS install, follow the
> [External Connectors operator runbook](../operations/external-connectors.md)
> — package the sidecar binary, register it in `connectors.json`, and
> the runtime registry will pick the connector type up at startup.

Sync Databricks Unity Catalog tables to Iceberg using Delta Change Data Feed (CDF) or watermark-based incremental reads.

## Sync model

- **Delta CDF (recommended)**: Captures inserts, updates, and deletes from Delta tables that have CDF enabled. Latency is in the minutes range.
- **Watermark incremental**: For tables without CDF, reads only rows newer than the last checkpoint. Suitable for append-only tables.

## Prerequisites

- Databricks workspace with Unity Catalog
- A SQL Warehouse (Serverless or Pro)
- Personal access token with `SELECT` on target tables

For Delta CDF mode, enable CDF on each source table:

```sql
ALTER TABLE my_catalog.my_schema.orders
  SET TBLPROPERTIES (delta.enableChangeDataFeed = true);
```

CDF must be enabled before the shuttle starts. Enabling it later does not backfill historical changes.

## CREATE CONNECTION

```sql
CREATE CONNECTION dbx_prod
  TYPE DATABRICKS
  PROPERTIES (
    workspace_url = 'https://adb-123456789012.1.azuredatabricks.net',
    token = SECRET 'vault://secrets/dbx_token',
    catalog = 'main',
    schema = 'default',
    warehouse_id = 'abc123def456'
  );
```

### Connection properties

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `workspace_url` | Yes | — | Databricks workspace URL (HTTPS) |
| `token` | Yes | — | Personal access token |
| `catalog` | Yes | — | Unity Catalog name |
| `schema` | No | `default` | Schema name |
| `warehouse_id` | Yes | — | SQL Warehouse ID |

## CREATE SHUTTLE

```sql
-- Delta CDF mode (captures inserts/updates/deletes)
CREATE SHUTTLE dbx_orders
  SOURCE dbx_prod TABLE orders
  TARGET warehouse.raw
  SCHEDULE EVERY '10 minutes';

-- Watermark-based for append-only tables
CREATE SHUTTLE dbx_events
  SOURCE dbx_prod TABLE events
  TARGET warehouse.raw
  SCHEDULE EVERY '15 minutes'
  WITH (watermark_column = 'event_time');
```

## Type mapping

| Databricks / Delta | Arrow | Iceberg |
|-------------------|-------|---------|
| `BOOLEAN` | Boolean | `boolean` |
| `BYTE` / `TINYINT` | Int8 | `int` |
| `SHORT` / `SMALLINT` | Int16 | `int` |
| `INT` / `INTEGER` | Int32 | `int` |
| `LONG` / `BIGINT` | Int64 | `long` |
| `FLOAT` | Float32 | `float` |
| `DOUBLE` | Float64 | `double` |
| `DECIMAL(p,s)` | Decimal128(p,s) | `decimal(p,s)` |
| `STRING` | Utf8 | `string` |
| `BINARY` | Binary | `binary` |
| `DATE` | Date32 | `date` |
| `TIMESTAMP` | Timestamp(μs, UTC) | `timestamptz` |
| `TIMESTAMP_NTZ` | Timestamp(μs, None) | `timestamp` |
| `ARRAY<T>` | Utf8 | `string` (JSON) |
| `MAP<K,V>` | Utf8 | `string` (JSON) |
| `STRUCT<...>` | Utf8 | `string` (JSON) |

## Limitations

- **Delta CDF must be enabled before shuttle creation.** Enabling CDF after the shuttle starts does not backfill — only new changes from that point forward are captured.
- `ARRAY`, `MAP`, and `STRUCT` types are serialized as JSON strings.
- Schema changes (column additions) are auto-detected in `compatible` evolution mode. Column drops and renames require shuttle restart.
- Databricks Runtime 12.0+ is required for `TIMESTAMP_NTZ` support.
