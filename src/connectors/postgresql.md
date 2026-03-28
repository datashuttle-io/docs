# PostgreSQL Connector

Replicate PostgreSQL tables to Iceberg via logical replication (WAL).

## Prerequisites

- **PostgreSQL 12+** with `wal_level = logical` in `postgresql.conf`
- A dedicated replication user with `REPLICATION` privilege
- A publication for the tables you want to replicate

## Source setup

```sql
-- Create a dedicated CDC user
CREATE USER datashuttle_cdc WITH REPLICATION PASSWORD 'your-password';

-- Grant read access to the tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO datashuttle_cdc;

-- Create a publication (all tables, or specific ones)
CREATE PUBLICATION datashuttle_pub FOR ALL TABLES;

-- Or for specific tables:
-- CREATE PUBLICATION datashuttle_pub FOR TABLE orders, customers, payments;
```

Verify logical replication is enabled:

```sql
SHOW wal_level;     -- must be "logical"
SHOW max_replication_slots;  -- must be > 0
```

## CREATE CONNECTION

```sql
CREATE CONNECTION pg_prod
  TYPE POSTGRES
  PROPERTIES (
    host = 'db.internal',
    port = 5432,
    database = 'production',
    username = 'datashuttle_cdc',
    password = SECRET 'vault://secrets/pg_pass',
    replication_slot = 'datashuttle_slot',
    publication = 'datashuttle_pub'
  );
```

## CREATE PIPELINE

```sql
-- Single table
CREATE PIPELINE orders_sync
  SOURCE pg_prod TABLE orders
  TARGET warehouse.raw
  WITH (mode = 'SNAPSHOT_THEN_CDC');

-- Multiple tables with options
CREATE PIPELINE crm_sync
  SOURCE pg_prod TABLE orders, customers, payments
  TARGET warehouse.raw
  WITH (
    mode = 'CDC',
    commit_interval = '30 seconds',
    delete_mode = 'deletion_vectors',
    schema_evolution = 'compatible'
  );
```

## CDC behavior

- **Mechanism**: PostgreSQL logical replication via `pgoutput` plugin
- **Initial load**: Parallel chunked `SELECT` with consistent snapshot
- **Change capture**: Reads from a replication slot (INSERT, UPDATE, DELETE)
- **Deletes**: Written as Iceberg V3 deletion vectors (Puffin files), not position deletes
- **Schema changes**: `ALTER TABLE ADD COLUMN` and compatible type widening are auto-applied (in `compatible` mode)
- **Replication slot**: Created automatically on first pipeline start. Held during pause, released on drop.

## Type mapping

| PostgreSQL | Arrow | Iceberg V3 |
|-----------|-------|-----------|
| `integer` | Int32 | `int` |
| `bigint` | Int64 | `long` |
| `smallint` | Int16 | `int` |
| `text` / `varchar` | Utf8 | `string` |
| `boolean` | Boolean | `boolean` |
| `timestamp` | Timestamp(μs) | `timestamptz` |
| `timestamptz` | Timestamp(μs, UTC) | `timestamptz` |
| `date` | Date32 | `date` |
| `jsonb` | Utf8 | `string` |
| `uuid` | Utf8 | `string` |
| `numeric` / `decimal` | Decimal128 | `decimal(p, s)` |
| `real` | Float32 | `float` |
| `double precision` | Float64 | `double` |
| `bytea` | Binary | `binary` |

## Limitations

- **TOAST columns**: Large values stored out-of-line require `REPLICA IDENTITY FULL` on the table for UPDATE events to include the full column value. Without it, unchanged TOAST columns appear as `NULL` in the CDC stream.
- **DDL replication**: Only column additions and compatible type widening are supported. Renaming columns or dropping columns requires manual intervention.
- **Partitioned tables**: Replicate individual partitions, not the parent table.
- **Sequences / generated columns**: Values are captured as-is. Sequences are not replicated.
