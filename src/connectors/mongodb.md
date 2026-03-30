# MongoDB Connector

Continuously sync MongoDB collections to Iceberg.

## Prerequisites

- **MongoDB 4.0+** deployed as a **replica set** (change streams require a replica set or sharded cluster)

## Source setup

No special configuration needed beyond having a replica set. Verify:

```javascript
// In mongosh
rs.status()
// Should show members with stateStr: "PRIMARY" and "SECONDARY"
```

If running a standalone instance for development, convert to a single-node replica set:

```javascript
rs.initiate()
```

## CREATE CONNECTION

```sql
CREATE CONNECTION mongo_prod
  TYPE MONGODB
  PROPERTIES (
    uri = 'mongodb://user:pass@mongo1:27017,mongo2:27017/mydb?replicaSet=rs0'
  );
```

The URI follows the [MongoDB connection string](https://www.mongodb.com/docs/manual/reference/connection-string/) format. Include all replica set members for failover.

## CREATE PIPELINE

```sql
-- Single collection, continuous schedule (default)
CREATE PIPELINE events_sync
  SOURCE mongo_prod TABLE events
  TARGET warehouse.raw;

-- Multiple collections with options
CREATE PIPELINE app_sync
  SOURCE mongo_prod TABLE events, users, sessions
  TARGET warehouse.raw
  WITH (
    commit_interval = '30 seconds'
  );

-- Periodic sync
CREATE PIPELINE hourly_sync
  SOURCE mongo_prod TABLE analytics
  TARGET warehouse.raw
  SCHEDULE EVERY '1 hour';
```

## Sync behavior

- **Continuous schedule**: Uses native change tracking (Change Streams) — latency is typically sub-second.
- **Periodic schedule**: Uses incremental reads at each interval.
- **Initial load**: Collection scan with a read concern of `majority` for consistency.
- **Deletes**: Written as Iceberg V3 deletion vectors.
- **Schema handling**: MongoDB is schemaless. DataShuttle infers the schema from the initial load and evolves it as new fields appear.

## Type mapping

| MongoDB (BSON) | Arrow | Iceberg V3 |
|----------------|-------|-----------|
| `String` | Utf8 | `string` |
| `Int32` | Int32 | `int` |
| `Int64` / `Long` | Int64 | `long` |
| `Double` | Float64 | `double` |
| `Boolean` | Boolean | `boolean` |
| `Date` | Timestamp(ms) | `timestamptz` |
| `ObjectId` | Utf8 | `string` (hex) |
| `Decimal128` | Decimal128 | `decimal` |
| `Binary` | Binary | `binary` |
| `Array` | List | `list` |
| `Object` (nested) | Struct | `struct` |

## Document flattening

By default, nested documents are mapped to Iceberg `struct` types. Top-level fields become columns:

```json
{"_id": "abc", "user": {"name": "Alice", "age": 30}, "total": 99.5}
```

Becomes:

| `_id` | `user` (struct) | `total` |
|-------|-----------------|---------|
| `"abc"` | `{name: "Alice", age: 30}` | `99.5` |

## Limitations

- **Replica set required**: Standalone MongoDB instances do not support change streams.
- **Pre-image / post-image**: MongoDB 6.0+ supports change stream pre-images. DataShuttle uses post-images by default. Pre-image support is planned.
- **Schema inference**: Deeply nested or polymorphic documents may require manual schema hints in future versions.
- **Capped collections**: Not supported for continuous sync (change streams don't work on capped collections).
