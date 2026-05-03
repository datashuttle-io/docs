# Query engine

> Status: architecture doc for the distributed SQL query engine
> rolling out across epic #850. Phase 0 (this page) locks the
> contract; Phases 1-5 ship the execution layers; Phases 6-9 polish
> UX, governance, and docs.

The SQL Console can target **four namespaces**: the upstream source
connector, the committed Iceberg snapshot, the live Flight buffer,
or the merged union of Iceberg and buffer. Every query — no matter
which target — is answered by the same DataFusion-backed engine
embedded in every daemon, so the SQL dialect, function library, and
type system stay identical.

Below is the mental model needed to reason about a query's path
through the cluster.

## Namespaces

| Namespace | What it reads | When to pick it |
|-----------|---------------|-----------------|
| `source.<conn>.<schema>.<table>` | Rows live in the upstream system (Postgres, MySQL, Kafka, file, REST, ...). A `SELECT` translates into a connector-driver scan. | Ad-hoc peek into production data before building a shuttle; verify row count before a CDC snapshot kicks off. |
| `iceberg.<ns>.<table>` | Committed Iceberg snapshots from the warehouse. Served via the object store with partition/file pruning. | Stable historical queries; cross-shuttle joins; anything where consistency matters more than freshness. |
| `buffer.<shuttle>` | The in-memory Arrow Flight ring buffer for a live shuttle. Reflects whatever has arrived from the source but hasn't been committed to Iceberg yet. TTL-bound. | Sub-second freshness for a single shuttle; "did my last INSERT land?" style checks. |
| `union.<shuttle>` | Iceberg ∪ buffer, deduplicated latest-wins by the shuttle's primary key. **Default** when the SQL doesn't specify. | Fresh *and* complete view — what most operational dashboards want. |

Resolution happens once per query on the coordinator; each table
reference is materialized into a `QueryTarget` (see
[`datashuttle_core::query::QueryTarget`]).

## Execution model

Three primitives work together.

1. **Coordinator.** The node the client POSTed `/api/v1/sql` to. It
   parses SQL, resolves namespaces, runs a size heuristic, picks
   workers, dispatches shard requests, merges their streams, and
   returns the final batch to the client.
2. **Workers.** Any live node in the cluster. They accept
   `/sql/internal/execute-shard` calls, execute a DataFusion
   physical plan fragment locally, and stream `RecordBatch`es back
   through Arrow Flight `DoGet`.
3. **`PoolScheduler`.** Selects workers under a resource pool's
   `max_concurrent_queries` + DPU budget. Queries share pool
   accounting with shuttles, so an over-subscribed tenant gets
   backpressure on both paths.

The lifecycle of one query:

```
client ──POST /sql──▶ coordinator ──┬─ /sql/internal/execute-shard ──▶ worker A ──Arrow Flight DoGet──▶ coordinator
                                    ├─ /sql/internal/execute-shard ──▶ worker B ──Arrow Flight DoGet──▶ coordinator
                                    └─ /sql/internal/execute-shard ──▶ worker C ──Arrow Flight DoGet──▶ coordinator
                                                                                                           │
                                                                                                           ▼
                                                                                                    merge + stream to client
```

### Size heuristic: when to distribute

Dispatching to remote workers is only worth the network hop if the
scan is large enough. The coordinator picks a fast path when the
estimated scan fits inside one node:

- scan < **100 MB** bytes read, **or**
- scan < **1 M** rows read

Iceberg stats and buffer row counters give us the estimate without
touching the data. Anything above both thresholds goes through the
distributed path. The thresholds are configurable per pool
(`pool.fast_path_max_bytes`, `pool.fast_path_max_rows`) once the
operator needs to tune for their cluster.

### Shard plan per target

| Target | Shard strategy | Who runs the shard |
|--------|----------------|---------------------|
| `source.*` | `PlanSource(parallelism_hint)` on the connector — N shards or 1 depending on driver + table. | The supervisor's lazy-spawned sidecar binary for the connector type (any worker the supervisor schedules). Phase 7.2 removed all in-proc driver paths from the api; every `source.*` shard runs in a sidecar process. |
| `iceberg.*` | File-list split: `ceil(num_files / target_files_per_shard)`. Any worker can read the object store. | Any worker from the pool's eligible set. |
| `buffer.<p>` | Exactly **one** shard; the buffer only exists on the shuttle's lease-owner node. | `lease.owner_node(p)`. Hard affinity. |
| `union.<p>` | Composite: one buffer shard on the owner + N iceberg shards as above. Dedup merged on the coordinator. | Mixed, per shard kind. |

### Retry + partial results

A shard that fails (worker death, connection reset, deadline) is
retried up to `retries_per_shard=2` on a different worker. If every
retry fails, the coordinator cancels the rest, returns **partial
results** to the client, and includes a warning describing which
shard bailed. A client that wants all-or-nothing can set
`mode=strict` on the request (Phase 7) to flip partial-success into
a hard error.

## Resource pool integration

Every query books against a resource pool for the duration of its
execution. The pool's new fields (`max_concurrent_queries`,
`max_query_dpu`) cap total parallelism per pool — not per query.
Preemption is LRU by query age with priority tiers.

- **Shared pools**: queries and shuttles compete on the same DPU
  budget. Dedicated pools (`pool.mode=dedicated`) never let a
  query leak over.
- **Tenant queue**: once a tenant hits `max_concurrent_queries`
  (from its BillingPlan tier), the coordinator returns `429
  Too Many Requests` with a `Retry-After` hint. No queue
  inside the coordinator — the client decides whether to retry.

## RBAC

Four new permissions gate query access:

| Permission | Scope holds | Granted by |
|------------|-------------|------------|
| `query.source` | Connection name, e.g. `pg_prod`. Wildcard `*` for all. | Connection owner or `admin`. |
| `query.iceberg` | First namespace segment, e.g. `warehouse`. | Catalog ACL or `admin`. |
| `query.buffer` | Shuttle name. | `admin` or shuttle owner. Implies `monitor_shuttle`. |
| `query.union` | Shuttle name. | Intersection — caller must hold both `query.iceberg:*` (for the shuttle's target namespace) and `query.buffer:<shuttle>`. |

YAML roles accept both dotted (`query.source:pg_prod`) and
underscored (`query_source:pg_prod`) short names.

## Quotas (per-tier)

The BillingPlan carries `max_query_rows`, `max_query_bytes`,
`max_query_seconds`, `max_concurrent_queries`. `0` on any field
means "unlimited at this tier". The coordinator projects these into
a [`QueryBudget`] at admission and ships it with every shard so
workers can self-limit without round-tripping back.

| Tier | Rows | Bytes | Seconds | Concurrent |
|------|------|-------|---------|------------|
| Community | 100k | 512 MB | 30s | 2 |
| Team | 10M | 10 GB | 300s | 10 |
| Business | ∞ | ∞ | 3600s | 50 |
| Enterprise | ∞ | ∞ | ∞ | 200 |

Quotas are enforced at three layers: admission (reject before
dispatch), per-shard (stop streaming past the cap), and audit
(record overage attempts).

## Shipped features (epic #850)

Everything below is live in `main` and feature-gated through
environment variables so a deployment can opt in incrementally.
See the [query-engine runbook](../../../runbooks/query-engine.md)
for day-to-day operator mechanics.

### Coordinator-side streaming — always on

The `FlightExchangeExec` physical operator pulls rows from remote
shards lazily; a `LIMIT 10` short-circuits after the first batch
without the coordinator allocating RAM for the rest of the
result. Landed in #903; no flag — this is the default shape for
distributed iceberg scans.

### Worker-side streaming — always on

`LocalShardExecutor` drives each iceberg / buffer scan through
`plan.execute(partition, task_ctx)` and feeds batches directly
into the Flight encoder. Replaced a `physical_plan::collect()`
at the worker in #906. Source shards still micro-collect for
limit slicing — tracked, not load-bearing in the current workloads.

### Cost-aware placement — always on

`rank_eligible_workers` orders peers by
`cost_score = cpu% + memory% + 10 × shuttle_count` ascending;
ties rotate deterministically by `hash(query_id)` so retries
preserve cache locality. `allocate_uris_by_weight` splits files
via the Largest Remainder Method so lighter peers take more
partitions than heavier ones. Landed in #902 / #905.

### Rendezvous-hash affinity — **`DATASHUTTLE_QUERY_AFFINITY=1`**

URI→worker affinity: each parquet URI's preferred worker is
`argmax_w hash(uri || 0x00 || worker_id(w))`. Repeat scans of
the same URI land on the same peer so the kernel page cache
stays warm. When a preferred worker is overloaded
(`cost_score > 90`) the URI falls back through the weight-based
allocator. Landed in #907 as an opt-in gate.

HRW's low-disruption property: when a worker leaves, only URIs
whose winner was that worker reshuffle — not the whole fleet.

### Row-level security — **`DATASHUTTLE_QUERY_RLS=1`**

`CREATE ROW POLICY <name> ON iceberg.<ns>.<t> FOR SELECT USING (<expr>)`
registers a predicate; enforcement wraps the iceberg provider in
a `RowPolicyTableProvider` that AND-injects the predicate into
every scan as a `FilterExec`. Landed in #911.

Caveats:

- In-memory only (no backend persistence yet). Policies
  evaporate on restart; the env gate exists so production
  deployments don't silently enable a non-persistent security
  feature.
- Only `SELECT` operation is honoured. INSERT / UPDATE / DELETE
  don't flow through the SQL handler in this system.
- Only iceberg targets accepted. Buffer is owner-pinned, source
  re-resolves credentials per worker — wrapping those paths
  lands in a follow-up.
- On distributed fan-out the coordinator applies the filter
  above the remote scan (shard ticket doesn't carry policy
  SQL). Predicate pushdown into the shard ticket is a separate
  task.

### Cross-source predicate pushdown — always on

`ConnectorScanProvider::supports_filters_pushdown` returns
`Inexact` for every filter so DataFusion's planner forwards the
WHERE predicate into `scan(filters=...)`. The legacy driver's
`expr_translator::translate_filters_to_postgres` turns it into
connector-native SQL; unsupported sub-expressions stay in the
`FilterExec` above the scan. Landed as a correctness fix in #912
after the regression test caught the default-Unsupported
behaviour was stripping the predicate.

### UI Console surfaces

Three Console hooks round out the epic:

- **Distributed footnote** (#908) — `SqlResult.distributed:
  {workers, kind}` structured field lights up a badge in the
  SQL console. Click a single-worker badge to deep-link into
  that peer's health row on the cluster page.
- **Workers dashboard** (#909) — `/cluster` page shows per-node
  CPU / memory bars, the `query_capable` pill, max-lag seconds,
  and auto-refreshes on a 5-second cadence. Deep link target is
  `/cluster#node-<id>`.
- **Plan viewer** (#910) — `EXPLAIN` results render as a card
  per plan with DataFusion's indentation preserved; distributed
  operators (`FlightExchangeExec`, `CoalescePartitionsExec`,
  `RepartitionExec`) get a blue tag so the fan-out boundary is
  visually obvious.

## Environment flags

| Flag | Default | Effect |
|------|---------|--------|
| `DATASHUTTLE_QUERY_DISTRIBUTE` | off | Coordinator may route iceberg / buffer / source scans to remote workers via Flight. Default-off path is byte-identical to the single-node one. |
| `DATASHUTTLE_QUERY_AFFINITY` | off | Rendezvous-hash URI→worker affinity instead of straight weight-based allocation. Requires `DISTRIBUTE=1`. |
| `DATASHUTTLE_QUERY_RLS` | off | Enforce registered row policies at iceberg scan time. Experimental — policies are in-memory only today. |

## See also

- [Query-engine operator runbook](../../../runbooks/query-engine.md)
- [ADR-0001: Distributed query engine](../../../query/adr-0001-distributed-query-engine.md)
- [Epic #850](https://github.com/datashuttle-ai/datashuttle/issues/850)
- [`datashuttle_core::query`](../api-reference/rust.md) — wire
  contract types.

[`datashuttle_core::query::QueryTarget`]: ../../../../crates/datashuttle-core/src/query/protocol.rs
[`QueryBudget`]: ../../../../crates/datashuttle-core/src/query/protocol.rs
