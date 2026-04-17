# Specification

This section summarises the DataShuttle engineering contract: the
pipeline state machine, commit batching semantics, tenant isolation
invariants, and the Iceberg V3 features (deletion vectors, partition
evolution) that DataShuttle exploits.

The canonical spec is maintained internally by the core team. The
public pages linked below cover the behaviour a user or operator
actually needs to reason about. If a subtle guarantee matters to
your integration, email <hello@datashuttle.ai> — we can share the
relevant excerpt under NDA.

## Sections at a glance

- **Pipeline Lifecycle** — the state machine each pipeline walks through
  (`Created → Starting → Running → Draining → …`). See
  [Pipeline Lifecycle](../concepts/pipeline-lifecycle.md) for the
  conceptual overview; the internal spec pins the exact transitions.
- **Commit Batching** — how CDC events accumulate into Iceberg commits.
  The [Commit Batching](../concepts/iceberg-commit-batching.md) page
  explains the knobs; the internal spec fixes the invariants.
- **Tenant Isolation** — hard rules that every ingestion/query path
  must honour. Directly enforced by `TenantContext` middleware in the
  API crate.
- **Safety & Correctness** — duplicate-suppression, exactly-once
  semantics, replay behaviour. Mirrored in
  [Safety & Correctness](../concepts/safety.md).
