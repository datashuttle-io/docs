# Specification

The canonical DataShuttle specification lives in `docs/SPEC.md` at the
repository root. It covers the pipeline state machine, commit batching
semantics, tenant isolation invariants, and the Iceberg V3 features
(deletion vectors, partition evolution) that DataShuttle exploits.

The mdBook copy is generated from that single source of truth; if you
need to cite the exact text, open the source file in the repo — the
mdBook render here is a mirror, not an authoritative fork.

## Sections at a glance

- **Pipeline Lifecycle** — the state machine each pipeline walks through
  (`Created → Starting → Running → Draining → …`). See
  [Pipeline Lifecycle](../concepts/pipeline-lifecycle.md) for the
  conceptual overview; the spec section pins the exact transitions.
- **Commit Batching** — how CDC events accumulate into Iceberg commits.
  The [Commit Batching](../concepts/iceberg-commit-batching.md) page
  explains the knobs; the spec fixes the invariants.
- **Tenant Isolation** — hard rules that every ingestion/query path
  must honour. Directly enforced by `TenantContext` middleware in the
  API crate.
- **Safety & Correctness** — duplicate-suppression, exactly-once
  semantics, replay behaviour. Mirrored in
  [Safety & Correctness](../concepts/safety.md).

## Why isn't it inlined here?

The spec changes more slowly than the rest of the docs; linking rather
than inlining avoids the pattern where the book drifts from the actual
engineering contract. When the spec moves, the changes land in
`docs/SPEC.md` and a review flags any book pages that now contradict
it.
