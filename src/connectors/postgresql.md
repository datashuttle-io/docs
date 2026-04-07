# PostgreSQL Connector

Continuously sync PostgreSQL tables to Iceberg.

## Prerequisites

- **PostgreSQL 12+** with `wal_level = logical` in `postgresql.conf`
- A dedicated replication user with `REPLICATION` privilege
- A publication for the tables you want to replicate

## Source setup

```sql
-- Create a dedicated user for DataShuttle
CREATE USER datashuttle WITH REPLICATION PASSWORD 'your-password';

-- Grant read access to the tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO datashuttle;

-- Create a publication (all tables, or specific ones)
CREATE PUBLICATION datashuttle_pub FOR ALL TABLES;

-- Or for specific tables:
-- CREATE PUBLICATION datashuttle_pub FOR TABLE orders, customers, payments;
```

Verify the required PostgreSQL settings:

```sql
SHOW wal_level;              -- must be "logical"
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
    username = 'datashuttle',
    password = SECRET 'vault://secrets/pg_pass',
    publication = 'datashuttle_pub'
  );
```

## CREATE PIPELINE

```sql
-- Single table, continuous schedule (default)
CREATE PIPELINE orders_sync
  SOURCE pg_prod TABLE orders
  TARGET warehouse.raw;

-- Multiple tables with options
CREATE PIPELINE crm_sync
  SOURCE pg_prod TABLE orders, customers, payments
  TARGET warehouse.raw
  WITH (
    commit_interval = '30 seconds',
    delete_mode = 'deletion_vectors',
    schema_evolution = 'compatible'
  );

-- Periodic sync
CREATE PIPELINE nightly_load
  SOURCE pg_prod TABLE analytics_events
  TARGET warehouse.raw
  SCHEDULE EVERY '1 hour';
```

## Sync behavior

- **Continuous schedule**: Uses native change tracking — latency is typically sub-second.
- **Periodic schedule**: Uses incremental reads at each interval.
- **Initial load**: Parallel chunked reads with a consistent view of the source.
- **Deletes**: Written as Iceberg V3 deletion vectors (Puffin files).
- **Schema changes**: `ALTER TABLE ADD COLUMN` and compatible type widening are auto-applied (in `compatible` mode).

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
| `json` / `jsonb` | Utf8 | `variant` (V3) |
| `uuid` | Utf8 | `uuid` |
| `numeric` / `decimal` | Decimal128 | `decimal(p, s)` |
| `real` | Float32 | `float` |
| `double precision` | Float64 | `double` |
| `bytea` | Binary | `binary` |
| `time` | Time64(μs) | `time` |
| `timetz` | Utf8 | `string` (timezone info preserved as text) |
| `inet` / `cidr` / `macaddr` | Utf8 | `string` |
| `interval` | Utf8 | `string` (ISO 8601) |
| `int[]` / `text[]` / `int4[]` | Utf8 | `string` (serialized) |
| `geometry` (PostGIS) | Binary | `geometry` (V3) |
| `geography` (PostGIS) | Binary | `geography` (V3) |

## Limitations

- **TOAST columns**: Large values stored out-of-line require `REPLICA IDENTITY FULL` on the table for UPDATE events to include the full column value.
- **DDL replication**: Only column additions and compatible type widening are supported. Renaming columns or dropping columns requires manual intervention.
- **Partitioned tables**: Replicate individual partitions, not the parent table.
- **Sequences / generated columns**: Values are captured as-is. Sequences are not replicated.
