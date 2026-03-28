# Safety & Correctness

DataShuttle handles production data pipelines. It uses a 5-layer defense-in-depth strategy for data integrity.

## Layer 1: Formal specification (TLA+)

Four TLA+ specifications are model-checked with TLC before implementation:

| Spec | What it verifies |
|------|------------------|
| `iceberg_commit.tla` | No lost commits under concurrent writers. No orphan files. Retry correctness. |
| `cdc_checkpoint.tla` | Exactly-once: no duplicates after crash recovery. No missed events. |
| `lease_ownership.tla` | No two nodes own the same pipeline simultaneously. Correct lease handoff. |
| `buffer_flush.tla` | No data loss during flush. No duplicates after crash mid-flush. |

## Layer 2: Defensive runtime

- **Crash-stop on invariant violation** — assertions halt the process rather than silently continuing with corrupt state
- **Circuit breakers** — anomaly detection pauses pipelines automatically (e.g., sudden row count drop, schema mismatch)
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

- **Canary pipelines** — route a fraction of traffic through a new version before full rollout
- **Automatic rollback** — revert to last known good state on corruption detection
- **Background reconciliation** — continuous verification tasks that alert on drift

## What this means in practice

If DataShuttle crashes at any point during a commit cycle:

1. The next startup reads the checkpoint from the Iceberg catalog
2. Resumes CDC from the checkpointed position
3. Detects and skips any duplicate batch (by `batch_id`)
4. Cleans up orphan files from the incomplete commit
5. Continues normal operation

No data loss. No duplicates. No manual intervention.

For the full specification, see [SAFETY.md](https://github.com/evgenyestepanov-star/datashuttle/blob/main/docs/SAFETY.md).
