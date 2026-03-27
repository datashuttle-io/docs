# Pipeline Lifecycle

A pipeline moves through these states:

```
Created → Snapshotting → Running → Paused
                ↓           ↓        ↓
              Error       Error   Unassigned
```

## Phases

1. **Created** — pipeline definition stored, not yet running
2. **Snapshotting** — initial parallel chunked load from source
3. **Running** — continuous CDC replication
4. **Paused** — user-initiated pause
5. **Error** — automatic pause on failure (circuit breaker)
6. **Unassigned** — no node owns this pipeline (awaiting lease)

## Exactly-Once Delivery

Each commit cycle:
1. Read CDC batch from source
2. Write Parquet + Puffin files to object storage
3. Atomic: commit to Iceberg catalog + update checkpoint
4. Acknowledge to source

On crash recovery, the checkpoint position determines where to resume. Duplicate commits are detected by `batch_id` in snapshot properties.
