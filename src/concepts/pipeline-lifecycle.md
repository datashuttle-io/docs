# Pipeline Lifecycle

A pipeline is the core unit of work in DataShuttle. It connects a source database to an Iceberg table and keeps them in sync.

## States

```
Created → Snapshotting → Running → Paused
                ↓           ↓        ↓
              Error       Error   Unassigned
```

| State | Description |
|-------|-------------|
| **Created** | Definition stored in the catalog, not yet running |
| **Snapshotting** | Initial parallel chunked load from the source |
| **Running** | Continuous CDC replication |
| **Paused** | User-initiated pause (replication slot held) |
| **Error** | Automatic pause on failure (circuit breaker tripped) |
| **Unassigned** | No node currently owns this pipeline (awaiting lease) |

## Phases of operation

### 1. Initial snapshot

When a pipeline starts for the first time, DataShuttle takes a parallel chunked snapshot of the source table:

```
Source table → SELECT chunks → Arrow RecordBatch → Parquet → Iceberg commit
```

Large tables are split into chunks and snapshotted in parallel. Progress is tracked per-chunk so a crash mid-snapshot resumes from the last completed chunk, not from the beginning.

### 2. CDC streaming

After the snapshot completes, DataShuttle switches to CDC mode:

```
WAL/binlog → Parse → Arrow → Micro-batch → Parquet + DVs → Iceberg commit
```

Each commit cycle:
1. Read a batch of CDC events from the source
2. Transform to Arrow RecordBatch
3. Write Parquet data files (inserts/updates) and Puffin deletion vector files (deletes)
4. Atomically commit to the Iceberg catalog and update the checkpoint
5. Acknowledge the batch to the source (advance replication slot / GTID)

### 3. Schema evolution

When DataShuttle detects a schema change in the source (e.g., `ALTER TABLE ADD COLUMN`):

- **`compatible` mode** (default): Automatically applies compatible changes to the Iceberg table (add columns, widen types)
- **`strict` mode**: Pauses the pipeline and emits a `pipeline.schema.changed` webhook event for manual approval

### 4. Compaction

Background compaction merges small Parquet files and cleans up deletion vectors. Runs automatically based on the configured `compaction_strategy`.

## Exactly-once delivery

DataShuttle guarantees exactly-once delivery through:

1. **Batch IDs** — each commit carries a UUID `batch_id` in the Iceberg snapshot properties. On crash recovery, duplicate commits are detected and skipped.
2. **Atomic checkpoint** — the CDC position (WAL LSN / binlog GTID) is updated atomically with the Iceberg commit. There is no window where data is committed but the checkpoint is not.
3. **Idempotent retries** — the commit protocol retries on conflict, producing the same result regardless of how many times it runs.

## Example: full lifecycle

```bash
# Create — pipeline is now in "Created" state
datashuttle sql -e "CREATE PIPELINE p1 SOURCE pg TABLE t1 TARGET wh.raw WITH (mode='CDC')"

# Pipeline auto-transitions: Created → Snapshotting → Running

# Pause — holds replication slot, stops reading
datashuttle sql -e "PAUSE PIPELINE p1"

# Resume — continues from last checkpoint
datashuttle sql -e "RESUME PIPELINE p1"

# Re-snapshot — drops data, takes fresh snapshot, then resumes CDC
datashuttle pipeline resnapshot p1

# Drop — removes pipeline, releases replication slot
datashuttle sql -e "DROP PIPELINE p1"
```
