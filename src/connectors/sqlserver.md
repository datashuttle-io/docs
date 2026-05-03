# SQL Server Connector

Continuously sync SQL Server tables to Iceberg using CDC tables or Change Tracking.

## Sync model

Two capture modes are supported:

| Mode | Captures deletes | Before-images | Latency | Requirement |
|------|:---------------:|:------------:|---------|-------------|
| `cdc` (default) | ✅ | ✅ | Seconds | CDC enabled on DB and table |
| `change_tracking` | ✅ (row deleted, no before-values) | ❌ | Seconds | CT enabled on DB and table |

Use `cdc` for full fidelity including delete capture and before/after row values. Use `change_tracking` when CDC is unavailable (e.g. Azure SQL Basic tier).

## Prerequisites

### CDC mode

```sql
-- Enable CDC on the database
EXEC sys.sp_cdc_enable_db;

-- Enable CDC on each table
EXEC sys.sp_cdc_enable_table
  @source_schema = 'dbo',
  @source_name   = 'orders',
  @role_name     = NULL;

-- Grant permissions
EXEC sp_addrolemember 'db_datareader', 'datashuttle';
GRANT SELECT ON SCHEMA::cdc TO datashuttle;
```

### Change Tracking mode

```sql
-- Enable Change Tracking on the database
ALTER DATABASE Northwind
  SET CHANGE_TRACKING = ON (CHANGE_RETENTION = 7 DAYS, AUTO_CLEANUP = ON);

-- Enable on each table
ALTER TABLE dbo.orders ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED = ON);
```

## CREATE CONNECTION

```sql
CREATE CONNECTION mssql_prod
  TYPE SQLSERVER
  PROPERTIES (
    host = 'sqlserver.internal',
    port = '1433',
    database = 'Northwind',
    username = 'datashuttle',
    password = SECRET 'vault://secrets/mssql_pass',
    cdc_mode = 'cdc',
    encrypt = 'required'
  );
```

For a named instance:

```sql
CREATE CONNECTION mssql_named
  TYPE SQLSERVER
  PROPERTIES (
    host = 'sqlserver.internal',
    instance_name = 'SQLEXPRESS',
    database = 'Northwind',
    username = 'datashuttle',
    password = SECRET 'vault://secrets/mssql_pass'
  );
```

For an Always On Availability Group read-only replica:

```sql
CREATE CONNECTION mssql_ag_replica
  TYPE SQLSERVER
  PROPERTIES (
    host = 'ag-listener.internal',
    port = '1433',
    database = 'Northwind',
    username = 'datashuttle',
    password = SECRET 'vault://secrets/mssql_pass',
    application_intent = 'read_only'
  );
```

### Connection properties

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `host` | Yes | — | SQL Server hostname |
| `port` | No | `1433` | TDS port |
| `database` | Yes | — | Database name |
| `username` | Yes | — | SQL login |
| `password` | Yes | — | Password |
| `instance_name` | No | — | Named instance (alternative to `port`) |
| `cdc_mode` | No | `cdc` | `cdc` or `change_tracking` |
| `encrypt` | No | `required` | `required` / `optional` / `not_supported` |
| `trust_server_certificate` | No | `false` | Trust self-signed TLS certificates |
| `application_intent` | No | `read_write` | `read_write` or `read_only` (AG replicas) |

## CREATE SHUTTLE

```sql
-- Continuous CDC
CREATE SHUTTLE mssql_orders
  SOURCE mssql_prod TABLE dbo.orders
  TARGET warehouse.raw
  SCHEDULE continuous;

-- Multiple tables
CREATE SHUTTLE mssql_crm
  SOURCE mssql_prod TABLE dbo.orders, dbo.customers, dbo.payments
  TARGET warehouse.raw
  SCHEDULE continuous
  WITH (commit_interval = '30 seconds');
```

## Type mapping

| SQL Server | Arrow | Iceberg |
|-----------|-------|---------|
| `bit` | Boolean | `boolean` |
| `tinyint` | UInt8 | `int` |
| `smallint` | Int16 | `int` |
| `int` | Int32 | `int` |
| `bigint` | Int64 | `long` |
| `real` | Float32 | `float` |
| `float` | Float64 | `double` |
| `decimal(p,s)` / `numeric(p,s)` | Decimal128(p,s) | `decimal(p,s)` |
| `money` | Decimal128(19,4) | `decimal(19,4)` |
| `smallmoney` | Decimal128(10,4) | `decimal(10,4)` |
| `char` / `varchar` / `text` | Utf8 | `string` |
| `nchar` / `nvarchar` / `ntext` | Utf8 | `string` |
| `binary` / `varbinary` / `image` | Binary | `binary` |
| `date` | Date32 | `date` |
| `time` | Time64(μs) | `time` |
| `datetime` | Timestamp(ms, None) | `timestamp` |
| `datetime2` | Timestamp(μs, None) | `timestamp` |
| `datetimeoffset` | Timestamp(μs, UTC) | `timestamptz` |
| `smalldatetime` | Timestamp(s, None) | `timestamp` |
| `uniqueidentifier` | Utf8 | `string` |
| `xml` | Utf8 | `string` |
| `geography` / `geometry` | Binary | `binary` |

## Limitations

- **CDC retention**: SQL Server purges CDC tables on a configurable schedule. If the shuttle is paused longer than the CDC retention window (default: 3 days), a full resync is triggered.
- **Table-level enablement**: CDC must be enabled per-table. Tables added to the shuttle after initial creation require CDC enablement before they stream changes.
- **`geography` / `geometry`**: Captured as raw WKB binary. V3 Geometry type mapping is planned.
- **Azure SQL Database**: CDC is supported on Standard tier and above. Basic tier supports Change Tracking only — set `cdc_mode = 'change_tracking'`.
