# Safety & Correctness

DataShuttle uses a 5-layer defense-in-depth strategy for production data integrity.

## Layer 1: Formal Specification (TLA+)

Four TLA+ specifications, model-checked with TLC:
- `iceberg_commit.tla` — concurrent commit protocol
- `cdc_checkpoint.tla` — exactly-once checkpoint recovery
- `lease_ownership.tla` — distributed lease acquisition
- `buffer_flush.tla` — hot buffer flush protocol

## Layer 2: Defensive Runtime

- Runtime assertions that crash-stop on invariant violation
- Circuit breakers for anomaly detection
- Write fencing with monotonic tokens
- Idempotent commits via batch_id

## Layer 3: Continuous Verification

- Source-target row count reconciliation
- Commit audit trail
- Orphan file detection

## Layer 4: Testing

- 340+ unit, integration, and chaos tests
- Property-based testing with proptest
- Chaos tests: kill during flush, crash with replicated buffer

## Layer 5: Operational Safety

- Canary pipelines
- Automatic rollback on corruption
- Background reconciliation tasks

See [SAFETY.md](https://github.com/evgenyestepanov-star/datashuttle/blob/main/docs/SAFETY.md) for the full specification.
