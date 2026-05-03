# Shuttle Lifecycle

A shuttle is the core unit of work in DataShuttle. It connects a source database to an Iceberg table and keeps them in sync.

## Scheduling

DataShuttle uses a **freshness-based sync model**. Users specify the desired data freshness; the system automatically selects the optimal sync mechanism based on connector capabilities.

| Schedule | Behavior |
|----------|----------|
| `continuous` (default) | Keep data as fresh as the source allows. Achievable latency depends on the source type. |
| `EVERY '<interval>'` | Sync at specified interval (e.g., `EVERY '15 minutes'`, `EVERY '24 hours'`). |

```sql
-- Continuous — system picks the fastest available mechanism
CREATE SHUTTLE orders_sync
  SOURCE pg_prod TABLE orders
  TARGET warehouse.raw
  SCHEDULE continuous;

-- Periodic — sync every 15 minutes
CREATE SHUTTLE daily_load
  SOURCE bq_prod TABLE reports
  TARGET warehouse.analytics
  SCHEDULE EVERY '15 minutes';
```

The initial load is always automatic on first shuttle start — it is not a user-selectable mode.

After creation, the UI and CLI show the achievable latency:

```
Shuttle: orders_sync
  Schedule: Continuous
  Latency: ~800ms (change tracking)
  Status: Synced
```

## States

```
Created → Syncing (initial load) → Running → Paused
                    ↓                  ↓        ↓
                  Error              Error   Unassigned
```

| State | Description |
|-------|-------------|
| **Created** | Definition stored, not yet running |
| **Syncing** | Initial load from the source in progress |
| **Running** | Continuous sync — data is flowing |
| **Paused** | User-initiated pause; position is held, no data lost |
| **Error** | Automatic pause on failure (circuit breaker tripped) |
| **Unassigned** | No node currently owns this shuttle (awaiting lease) |

## Phases of operation

### 1. Initial load

When a shuttle starts for the first time, DataShuttle loads all existing data from the source into Iceberg:

```
Source table → chunked reads → Arrow RecordBatch → Parquet → Iceberg commit
```

Large tables are split into chunks and loaded in parallel. Progress is tracked per-chunk so a failure mid-load resumes from the last completed chunk, not from the beginning.

### 2. Continuous sync

After the initial load completes, DataShuttle transitions to continuous sync — tracking changes as they happen in the source:

```
Source changes → Parse → Arrow → Micro-batch → Parquet + DVs → Iceberg commit
```

Each commit cycle:
1. Read a batch of changes from the source
2. Transform to Arrow RecordBatch
3. Write Parquet data files (inserts/updates) and Puffin deletion vector files (deletes)
4. Atomically commit to the Iceberg catalog and update the sync position
5. Acknowledge the batch to the source

The specific mechanism used (native change tracking, incremental query, or full diff) depends on the source connector's capabilities and is invisible to the user.

### 3. Schema evolution

When DataShuttle detects a schema change in the source (e.g., `ALTER TABLE ADD COLUMN`):

- **`compatible`** (default): Automatically applies compatible changes to the Iceberg table (add columns, widen types)
- **`strict`**: Pauses the shuttle and emits a `shuttle.schema.changed` event for manual approval

### 4. Compaction

Background compaction merges small Parquet files and cleans up deletion vectors. Runs automatically based on the configured `compaction_strategy`.

## Exactly-once delivery

DataShuttle guarantees exactly-once delivery through:

1. **Batch IDs** — each commit carries a UUID `batch_id` in the Iceberg metadata. On recovery, duplicate commits are detected and skipped.
2. **Atomic checkpoint** — the sync position is updated atomically with the Iceberg commit. There is no window where data is committed but the position is not.
3. **Idempotent retries** — the commit protocol retries on conflict, producing the same result regardless of how many times it runs.

## Example: full lifecycle

```bash
# Create — shuttle is now in "Created" state
datashuttle sql -e "CREATE SHUTTLE p1 SOURCE pg TABLE t1 TARGET wh.raw"

# Shuttle auto-transitions: Created → Syncing → Running

# Pause — position is held, stops reading
datashuttle sql -e "PAUSE SHUTTLE p1"

# Resume — continues from last position
datashuttle sql -e "RESUME SHUTTLE p1"

# Resync — re-load from source, then resume continuous sync
datashuttle shuttle resnapshot p1

# Drop — removes shuttle definition
datashuttle sql -e "DROP SHUTTLE p1"
```
