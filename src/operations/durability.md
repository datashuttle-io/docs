# Hot-buffer durability

## Where the durability boundary actually is

DataShuttle's hot path acknowledges a write before it lands in object
storage. The acknowledgment is meaningful **only** to the extent the
buffer survives a single node loss before its first Iceberg commit. As
of v0.2.x the buffer is **single-node**:

| Phase             | Where the bytes live          | Survives crash? |
|-------------------|-------------------------------|-----------------|
| 1. CDC ingest     | `HotBuffer` (in-memory)       | No              |
| 2. Spill          | Local disk, if configured     | Single-node yes |
| 3. Iceberg commit | Object store + catalog        | Yes (replicated by storage tier) |

`InMemoryRaftReplicator` in `crates/datashuttle-flight/src/replication.rs`
is a **single-process simulation** for unit tests. There is no
cross-node transport, no leader election, no log persistence. Multi-node
Raft is on the roadmap (issue [#970] option A) — until it ships, do not
treat the hot path as a replication boundary.

The durability boundary that **does** hold is the first successful
Iceberg commit. From that point on the data is replicated by your
object store (S3, GCS, MinIO with EC) and the Iceberg catalog protects
the snapshot lineage.

## RPO model

Hot path RPO = `flush_interval` (the worst case is a node loss right
before the next flush). Defaults:

| Mode             | `flush_interval` | Rationale |
|------------------|------------------|-----------|
| OSS / on-prem    | 30s              | Throughput vs. small-file pressure |
| Cloud (managed)  | 30s              | Same — cloud does not yet replicate the buffer |
| `--require-replication` | refuse to start in `mode=cluster` until #970 option A ships | Fail-fast for zero-RPO contracts |

To tighten RPO without waiting for cross-node Raft: lower
`flush_interval` (per-shuttle `WITH (flush_interval='5s')`), or
operate in single-node mode where the disk-spill in
`crates/datashuttle-flight/src/overflow.rs` survives an OS-level crash
(spilled batches are replayed on startup).

## `--require-replication`

`datashuttled start --require-replication` (or env
`DATASHUTTLE_REQUIRE_REPLICATION=1`) refuses to start any node in
`mode=cluster` while the multi-node Raft transport is missing. Used by
operators who want a hard failure rather than silent single-node
durability inside a multi-node deployment.

`mode=single-node` ignores the flag — the hot buffer's RPO is well-
defined there and is bounded by `flush_interval`.

## What changes when #970 option A ships

The plan in [issue #970] adds `OpenRaftReplicator` (openraft on Arrow
Flight transport, on-disk log via sled). Once shipped:

- Hot-path RPO becomes `min(flush_interval, replication_lag)`.
- `--require-replication` flips from "refuse to start in cluster" to
  "refuse to start until majority quorum is reachable".
- The TLA+ model in `docs/tla/buffer_flush.tla` gains a Raft-replication
  invariant.

This document will be updated when that lands; until then, the table
above is the contract.

## Related issues

- [#970] — hot-buffer durability gap (this doc closes option B).
- `docs/tla/buffer_flush.tla` — formal model of the flush state machine.

[#970]: https://github.com/evgenyestepanov-star/datashuttle/issues/970
[issue #970]: https://github.com/evgenyestepanov-star/datashuttle/issues/970
