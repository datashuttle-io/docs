# Safety & Correctness

DataShuttle handles production data shuttles. It uses a 5-layer defense-in-depth strategy for data integrity.

## Layer 1: Formal specification (TLA+)

Four TLA+ specifications are model-checked with TLC before implementation:

| Spec | What it verifies |
|------|------------------|
| `iceberg_commit.tla` | No lost commits under concurrent writers. No orphan files. Retry correctness. |
| `cdc_checkpoint.tla` | Exactly-once: no duplicates after crash recovery. No missed events. |
| `lease_ownership.tla` | No two nodes own the same shuttle simultaneously. Correct lease handoff. |
| `buffer_flush.tla` | No data loss during flush. No duplicates after crash mid-flush. |

## Layer 2: Defensive runtime

- **Crash-stop on invariant violation** — assertions halt the process rather than silently continuing with corrupt state
- **Circuit breakers** — anomaly detection pauses shuttles automatically (e.g., sudden row count drop, schema mismatch)
- **Write fencing** — monotonic fencing tokens prevent stale nodes from writing after losing a lease
- **Idempotent commits** — every batch carries a UUID `batch_id`; duplicate commits are detected and skipped

## Layer 3: Continuous verification

- **Source-target reconciliation** — periodic row count comparison between source and Iceberg
- **Commit audit trail** — every commit is logged with batch ID, row count, file list, and timestamp
- **Orphan file detection** — background scan finds and cleans up unreferenced data files

## Layer 4: Testing

- **340+ tests** — unit, integration, and chaos tests
- **Property-based testing** — `proptest` for transforms and buffer operations
- **Chaos tests** — kill during flush, crash with replicated buffer, network partition simulation

## Layer 5: Operational safety

- **Canary shuttles** — route a fraction of traffic through a new version before full rollout
- **Automatic rollback** — revert to last known good state on corruption detection
- **Background reconciliation** — continuous verification tasks that alert on drift

## What this means in practice

If DataShuttle crashes at any point during a commit cycle:

1. The next startup reads the checkpoint from the Iceberg catalog
2. Resumes sync from the checkpointed position
3. Detects and skips any duplicate batch (by `batch_id`)
4. Cleans up orphan files from the incomplete commit
5. Continues normal operation

No data loss. No duplicates. No manual intervention.

## Snapshot resume (#461)

Initial-load (snapshot) crashes are handled by the same per-flush
checkpoint contract as continuous sync, with one extra invariant:
**the resume cursor is written into the Iceberg snapshot summary
on every commit**, so the catalog itself is the authoritative
source of "what is durably written". The local checkpoint file is
a cache; if it falls behind reality (e.g. crash between catalog
commit and local fsync), startup re-reads
`datashuttle.snapshot_position.column` /
`datashuttle.snapshot_position.value` from the latest snapshot
summary and seeds the in-memory checkpoint from there before
deciding whether to enter the snapshot loop.

The contract pieces:

1. **Per-flush write.** Every successful `IcebergWriter::flush()`
   advances the local checkpoint atomically — no longer waits for
   the entire snapshot phase to finish. A snapshot interrupted at
   the 60% mark resumes from ~60%, not from row 0.
2. **Generic resume cursor.** `CDCPosition::PrimaryKey { column,
   value }` is the canonical resume cursor. It propagates through
   `SnapshotConfig.resume_after_pk` and is honored by every
   snapshot connector that takes a PK lower bound, regardless of
   whether the user declared a watermark column.
3. **Catalog as source of truth.** The same `(column, value)`
   pair is written into the snapshot summary properties on every
   commit (`datashuttle.snapshot_position.*`). On startup, the
   shuttle manager reads the latest snapshot of every target
   table; if the catalog value is ahead of the local checkpoint,
   the local checkpoint is overwritten.
4. **WAL-recovery coordination.** When `recover_wal` commits
   parquet files left behind by a crash, the resulting
   `FlushStats.source_position_hi` advances the local checkpoint
   *before* the snapshot loop evaluates `should_snapshot`. The
   common "WAL recovery commits 18 M rows, then snapshot
   re-reads the same 18 M from row 0" double-write is closed.

The remaining piece of the original #461 plan — per-shard cursors
for parallel snapshots across multiple physical shards — is
tracked as a follow-up. Single-shard / single-worker shuttles
(the dominant case) get exactly-once guarantees today; multi-
shard parallel snapshots get the per-table guarantees but the
collapsed cross-shard cursor uses the conservative `min` of all
shards, which can cause a small re-read from the slowest shard's
tail on crash.

The summary above is the correct abridged view of the crash-recovery
proofs, replay contracts, and exactly-once guarantees these
invariants add up to. If a particular guarantee matters to your
integration and you need the full formal statement, email
<hello@datashuttle.ai> — we can share the relevant excerpt under NDA.
