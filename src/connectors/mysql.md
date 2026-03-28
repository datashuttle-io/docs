# MySQL Connector

Replicate MySQL tables to Iceberg via binary log (binlog) with GTID tracking.

## Prerequisites

- **MySQL 8.0+** with `binlog_format = ROW` and GTID enabled
- A user with `REPLICATION SLAVE` and `REPLICATION CLIENT` privileges

## Source setup

```sql
-- Create a dedicated CDC user
CREATE USER 'datashuttle'@'%' IDENTIFIED BY 'your-password';
GRANT SELECT, REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'datashuttle'@'%';
```

Verify binlog settings:

```sql
SHOW VARIABLES LIKE 'binlog_format';        -- must be ROW
SHOW VARIABLES LIKE 'gtid_mode';            -- must be ON
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

## CREATE PIPELINE

```sql
-- Single table
CREATE PIPELINE orders_sync
  SOURCE mysql_prod TABLE orders
  TARGET warehouse.raw
  WITH (mode = 'SNAPSHOT_THEN_CDC');

-- Multiple tables
CREATE PIPELINE crm_sync
  SOURCE mysql_prod TABLE orders, customers
  TARGET warehouse.raw
  WITH (
    mode = 'CDC',
    commit_interval = '30 seconds',
    delete_mode = 'deletion_vectors',
    schema_evolution = 'compatible'
  );
```

## CDC behavior

- **Mechanism**: MySQL binary log with GTID-based position tracking
- **Initial load**: Parallel chunked `SELECT` with consistent snapshot (`START TRANSACTION WITH CONSISTENT SNAPSHOT`)
- **Change capture**: Reads binlog events (INSERT, UPDATE, DELETE) via the replication protocol
- **Deletes**: Written as Iceberg V3 deletion vectors
- **Schema changes**: `ALTER TABLE ADD COLUMN` and compatible type widening are auto-applied (in `compatible` mode)
- **Position tracking**: GTID set is checkpointed with each Iceberg commit. On recovery, resumes from the last GTID.

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
