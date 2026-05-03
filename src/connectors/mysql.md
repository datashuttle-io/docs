# MySQL Connector

Continuously sync MySQL tables to Iceberg.

## Prerequisites

- **MySQL 8.0+** with `binlog_format = ROW` and GTID enabled
- A user with `REPLICATION SLAVE` and `REPLICATION CLIENT` privileges

## Source setup

```sql
-- Create a dedicated user for DataShuttle
CREATE USER 'datashuttle'@'%' IDENTIFIED BY 'your-password';
GRANT SELECT, REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'datashuttle'@'%';
```

Verify the required MySQL settings:

```sql
SHOW VARIABLES LIKE 'binlog_format';             -- must be ROW
SHOW VARIABLES LIKE 'gtid_mode';                 -- must be ON
SHOW VARIABLES LIKE 'enforce_gtid_consistency';  -- must be ON
```

If not already set, add to `my.cnf`:

```ini
[mysqld]
binlog_format = ROW
gtid_mode = ON
enforce_gtid_consistency = ON
binlog_row_image = FULL
```

## CREATE CONNECTION

```sql
CREATE CONNECTION mysql_prod
  TYPE MYSQL
  PROPERTIES (
    host = 'mysql.internal',
    port = 3306,
    database = 'production',
    username = 'datashuttle',
    password = SECRET 'vault://secrets/mysql_pass'
  );
```

## CREATE SHUTTLE

```sql
-- Single table, continuous schedule (default)
CREATE SHUTTLE orders_sync
  SOURCE mysql_prod TABLE orders
  TARGET warehouse.raw;

-- Multiple tables with options
CREATE SHUTTLE crm_sync
  SOURCE mysql_prod TABLE orders, customers
  TARGET warehouse.raw
  WITH (
    commit_interval = '30 seconds',
    delete_mode = 'deletion_vectors',
    schema_evolution = 'compatible'
  );

-- Periodic sync
CREATE SHUTTLE nightly_load
  SOURCE mysql_prod TABLE reports
  TARGET warehouse.analytics
  SCHEDULE EVERY '1 hour';
```

## Sync behavior

- **Continuous schedule**: Uses native change tracking — latency is typically sub-second.
- **Periodic schedule**: Uses incremental reads at each interval.
- **Initial load**: Parallel chunked reads with a consistent view of the source.
- **Deletes**: Written as Iceberg V3 deletion vectors.
- **Schema changes**: `ALTER TABLE ADD COLUMN` and compatible type widening are auto-applied (in `compatible` mode).

## Type mapping

| MySQL | Arrow | Iceberg V3 |
|-------|-------|-----------|
| `INT` | Int32 | `int` |
| `BIGINT` | Int64 | `long` |
| `SMALLINT` / `TINYINT` | Int16 / Int8 | `int` |
| `VARCHAR` / `TEXT` | Utf8 | `string` |
| `BOOLEAN` / `TINYINT(1)` | Boolean | `boolean` |
| `DATETIME` | Timestamp(μs) | `timestamptz` |
| `TIMESTAMP` | Timestamp(μs, UTC) | `timestamptz` |
| `DATE` | Date32 | `date` |
| `JSON` | Utf8 | `string` |
| `DECIMAL` | Decimal128 | `decimal(p, s)` |
| `FLOAT` | Float32 | `float` |
| `DOUBLE` | Float64 | `double` |
| `BLOB` / `BINARY` | Binary | `binary` |
| `ENUM` | Utf8 | `string` |

## Limitations

- **GTID required**: Non-GTID MySQL instances are not supported. GTID provides reliable position tracking across failovers.
- **`binlog_row_image = FULL` recommended**: With `MINIMAL`, UPDATE events may not include all column values, causing incomplete rows in Iceberg.
- **DDL replication**: Only column additions and compatible type widening. Column renames and drops require manual intervention.
- **Multi-source replication**: Each MySQL source needs its own connection. Cross-source joins are not supported.
