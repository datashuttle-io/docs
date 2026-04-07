# Iceberg Commit Batching

DataShuttle batches many Arrow record batches into a single Iceberg
snapshot commit instead of committing on every batch. This is the
mechanism that keeps large-table snapshots running at constant
throughput regardless of how many rows have already been written.

## Why batching exists

Every Iceberg snapshot is a tiny ACID transaction. The commit path
does roughly this work:

1. `GET` the table's `metadata.json` (cumulative — grows with the
   number of snapshots).
2. `GET` the parent **manifest list** (an Avro file enumerating every
   manifest in the current snapshot).
3. Add one new entry pointing at the freshly written manifest.
4. Re-serialize and `PUT` the new manifest list.
5. `POST` an `add-snapshot` update to the catalog.

If DataShuttle issued a commit per Arrow batch, the manifest list
would grow by one entry per commit. The download → parse → re-upload
loop in steps 2–4 then becomes O(N) per commit, and the cumulative
work across the whole snapshot becomes O(N²). On a 100M-row source
that means thousands of commits where each successive one is slightly
slower, and the second half of the table writes far slower than the
first half.

The fix is straightforward: stage the parquet files in a buffer, and
flush them as one commit. One commit holding 1000 files does the
same five steps as one commit holding one file — the per-commit cost
is roughly constant, and the cumulative cost drops to O(N).

## How it works

DataShuttle's Iceberg writer keeps a per-table staging slot:

```text
staging[(namespace, table)] = StagingSlot {
    files: Vec<PendingFile>,
    total_bytes: u64,
    oldest_at: Instant,
}
```

`stage_batch()` writes the parquet for an Arrow batch to S3 immediately
— that part has not changed — but it does **not** commit. Instead it
appends a `PendingFile` to the slot and persists the slot's metadata
to a write-ahead log (see *Crash safety* below). When any of the
configured thresholds trips, the slot auto-flushes.

A flush issues exactly one Iceberg commit holding **all** staged
files for that table. There is one new manifest, one parent
manifest-list rewrite, and one `add-snapshot` POST — regardless of how
many parquet files are in the slot.

```text
stage_batch ──▶ parquet uploaded to S3, slot grows
stage_batch ──▶ parquet uploaded to S3, slot grows
stage_batch ──▶ slot crosses commit_batch_files
                     │
                     └─▶ flush ──▶ ONE Iceberg commit (N files)
```

## Thresholds

Three thresholds drive auto-flush. The slot flushes the moment **any
one** of them is exceeded:

| Threshold | Snapshot default | CDC default | Purpose |
|---|---|---|---|
| `commit_batch_files` | `1000` | `100` | Cap on parquet count to keep manifests within Iceberg's recommended size. |
| `commit_batch_bytes` | `256 MB` | `64 MB` | Cap on staged data so a flush failure can never lose more than this much. |
| `commit_batch_interval` | `30 seconds` | `5 seconds` | Cap on freshness so a slow source still produces visible commits. |

CDC defaults are tighter so streaming consumers see fresh rows
quickly. Snapshot defaults are larger so bulk loads of multi-billion-
row tables stay efficient.

In addition to the auto-flush, DataShuttle issues a **final flush**
per table at the end of its snapshot, and on graceful shutdown. The
table is never left with files in the staging buffer in normal
operation.

## Configuring

### Server-wide defaults

Set the defaults in `datashuttle.yaml` under `pipeline_defaults`:

```yaml
pipeline_defaults:
  # Snapshot phase — bulk loads.
  commit_batch_files: 1000
  commit_batch_bytes: "256 MB"
  commit_batch_interval: "30 seconds"

  # CDC phase — continuous streaming.
  cdc_commit_batch_files: 100
  cdc_commit_batch_bytes: "64 MB"
  cdc_commit_batch_interval: "5 seconds"
```

These are also editable in the **Settings → Pipeline Defaults → Iceberg
Commit Batching** panel of the Web UI, and writable via
`PUT /api/v1/settings/pipeline_defaults`.

### Per-pipeline overrides

Override either or both phases per pipeline using the `WITH (...)`
clause:

```sql
CREATE PIPELINE big_load
FROM postgres://...
TO iceberg.warehouse.events
WITH (
    commit_batch_files = 5000,
    commit_batch_bytes = '1 GB',
    commit_batch_interval = '60 seconds',
    cdc_commit_batch_files = 50,
    cdc_commit_batch_interval = '2 seconds'
);
```

Pipeline-level options always win over the server defaults.

## Crash safety — the WAL

Files are uploaded to S3 **before** the catalog commit happens. If
DataShuttle crashes between staging a file and flushing the slot, the
parquet sits in S3 with no Iceberg snapshot referencing it. Without
recovery these would become orphan files.

To prevent that, every `stage_batch()` call appends to a **pending
files write-ahead log** at:

```text
<data_dir>/iceberg-wal/<pipeline>__<namespace>__<table>.json
```

The WAL entry records the file path, schema, partition spec, sort
order, row count, and byte size. On startup the pipeline calls
`recover_wal()`, which:

1. Reads every pending WAL file owned by this pipeline.
2. `HEAD`s each parquet to confirm it still exists in S3.
3. Loads the surviving entries into the staging buffer.
4. Issues one final flush per `(namespace, table)`.

After a successful flush the WAL file for that slot is removed.
Recovery is idempotent — replaying it on a healthy pipeline simply
finds an empty WAL.

## Observability

Four Prometheus metrics surface the buffer state:

| Metric | Type | Labels | Description |
|---|---|---|---|
| `datashuttle_iceberg_pending_files` | Gauge | `pipeline`, `table` | Files currently in the staging slot. |
| `datashuttle_iceberg_pending_bytes` | Gauge | `pipeline`, `table` | Bytes currently staged. |
| `datashuttle_iceberg_flushes_total` | Counter | `pipeline`, `reason` | Flush count, where `reason` is `auto`, `final`, or `wal_recovery`. |
| `datashuttle_iceberg_flush_duration_seconds` | Histogram | `pipeline` | Wall-clock duration of each flush. |

Useful queries:

```promql
# Throughput of commits, not Arrow batches
rate(datashuttle_iceberg_flushes_total[5m])

# Average flush latency
rate(datashuttle_iceberg_flush_duration_seconds_sum[5m])
  / rate(datashuttle_iceberg_flush_duration_seconds_count[5m])

# Anything stuck in the buffer right now
sum by (pipeline, table) (datashuttle_iceberg_pending_files)
```

## Tradeoffs

- **Latency vs efficiency.** Larger batches mean fewer Iceberg commits
  but a longer time-to-first-snapshot. The CDC defaults are biased
  toward latency; snapshot defaults toward efficiency.
- **Failure blast radius.** If a flush fails after several stage
  calls succeed, the failed flush leaves up to `commit_batch_bytes` of
  parquet in the WAL until recovery picks it up. Smaller `commit_batch_bytes`
  reduces this window.
- **Memory.** The staging slot keeps `DataFile` metadata in memory.
  At 1000 files per slot the footprint is on the order of a few MB —
  well below normal pipeline overhead.

## Internals (for contributors)

- Implementation: `crates/datashuttle-iceberg/src/writer.rs`
  - `BatchingThresholds`, `PendingFile`, `StagingSlot`, `FlushStats`
  - `stage_batch()`, `flush()`, `flush_all()`, `should_auto_flush()`
  - `set_wal_dir()`, `recover_wal()`, `sanitize_wal_segment()`
  - `commit_to_catalog_batch()` is the one-shot commit path that
    accepts a `&[DataFile]` and rewrites the manifest list once.
- Wiring: `crates/datashuttle-api/src/pipeline_manager.rs`
  - `resolve_batching_thresholds()` layers writer defaults → server
    defaults → pipeline overrides.
- Tracking issue: [#457](https://github.com/evgenyestepanov-star/datashuttle/issues/457).
