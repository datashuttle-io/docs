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

## CREATE SHUTTLE

```sql
-- Single collection, continuous schedule (default)
CREATE SHUTTLE events_sync
  SOURCE mongo_prod TABLE events
  TARGET warehouse.raw;

-- Multiple collections with options
CREATE SHUTTLE app_sync
  SOURCE mongo_prod TABLE events, users, sessions
  TARGET warehouse.raw
  WITH (
    commit_interval = '30 seconds'
  );

-- Periodic sync
CREATE SHUTTLE hourly_sync
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

## What happens if the oplog rotates?

MongoDB change streams resume from an opaque **resume token** issued by the server. The token points into the replica set's oplog — a capped collection whose size is fixed at deployment time. If the oplog rotates past the persisted resume token (e.g. because a shuttle was paused for longer than the oplog's retention window, or an ingestion rate spike evicted older entries), the server rejects the resume with the `ChangeStreamHistoryLost` error (code 286).

DataShuttle detects this condition and **auto-recovers**:

1. The MongoDB connector returns a typed `ResumeTokenExpired` error instead of a generic failure.
2. The shuttle manager catches this error and:
   - Resets the checkpoint for every tracked collection in the shuttle.
   - Emits a `cdc.resume_token_expired` lifecycle event (severity: `Warning`) with the collection list and the old token for observability.
3. On the next scheduler tick the shuttle re-enters the snapshot phase, re-reads every collection from scratch, and opens a **fresh change stream** from the current oplog tail.

**Durability guarantee.** Events already committed to Iceberg before the token expired are not re-read from the oplog — they are already in the lake. The re-snapshot covers any in-flight documents that were observed on the stream but had not yet landed in a committed Iceberg snapshot at the moment of expiry. The result is at-least-once delivery across the rotation boundary; Iceberg merge-on-read with primary-key identity (`_id`) deduplicates any overlap on the target side.

**Preventing expiry.** Size the oplog for your longest expected shuttle pause plus a safety margin. Rule of thumb:

```javascript
// In mongosh — check current oplog window
rs.printReplicationInfo()
// Resize if too small (example: 50 GB)
db.adminCommand({ replSetResizeOplog: 1, size: 50000 })
```

Monitor the `cdc.resume_token_expired` event — a spike indicates the oplog is undersized for your workload.

## Limitations

- **Replica set required**: Standalone MongoDB instances do not support change streams.
- **Pre-image / post-image**: MongoDB 6.0+ supports change stream pre-images. DataShuttle uses post-images by default. Pre-image support is planned.
- **Schema inference**: Deeply nested or polymorphic documents may require manual schema hints in future versions.
- **Capped collections**: Not supported for continuous sync (change streams don't work on capped collections).
