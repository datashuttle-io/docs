# MongoDB Connector

Replicate MongoDB collections to Iceberg via Change Streams.

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
-- Single collection
CREATE PIPELINE events_sync
  SOURCE mongo_prod TABLE events
  TARGET warehouse.raw
  WITH (mode = 'SNAPSHOT_THEN_CDC');

-- Multiple collections
CREATE PIPELINE app_sync
  SOURCE mongo_prod TABLE events, users, sessions
  TARGET warehouse.raw
  WITH (
    mode = 'CDC',
    commit_interval = '30 seconds'
  );
```

## CDC behavior

- **Mechanism**: MongoDB Change Streams (`watch()`)
- **Initial load**: Collection scan with a read concern of `majority` for consistency
- **Change capture**: INSERT, UPDATE, DELETE, and REPLACE operations
- **Deletes**: Written as Iceberg V3 deletion vectors
- **Schema handling**: MongoDB is schemaless. DataShuttle infers the schema from the initial snapshot and evolves it as new fields appear.
- **Resume token**: The change stream resume token is checkpointed with each Iceberg commit. On recovery, the stream resumes from the last token.

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
- **Capped collections**: Not supported for CDC (change streams don't work on capped collections).
