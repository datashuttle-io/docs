# Distributed queries

How a SQL query that touches iceberg, buffer, or source data
actually gets from the caller's keystroke to a row. Companion to
the [query engine](./query-engine.md) chapter: that one is the
mental model, this one is the execution story.

## Two-node walkthrough

A cluster with a coordinator `C` and a worker `W`. `W` advertises
`query_capable = true` + a Flight address in its gossip state.

```
caller  ─POST /sql──▶  coordinator C
                         │
                         1. parse SQL → AST
                         2. extract iceberg / buffer / source refs
                         3. RBAC check per ref
                         4. for each ref: decide local vs remote
                         5. build SessionContext, register providers
                         6. plan + execute (DataFusion)
                         │
                         ▼
                    response JSON
```

Step 4 is where the split lives. When `DATASHUTTLE_QUERY_DISTRIBUTE=1`
and a remote peer is eligible (query-capable, not self, Flight
addr advertised), the coordinator builds a `QueryShardRequest`
and ships it via `do_get` to `W`. Otherwise it scans locally.

## Coordinator vs worker split

| Responsibility | Coordinator | Worker |
|----------------|-------------|--------|
| Parse SQL | ✓ | — |
| RBAC check | ✓ | — (trusts coordinator) |
| Ref extraction | ✓ | — |
| Shard planning | ✓ | — |
| Provider scan + filter + projection | delegated to worker when distributed | ✓ |
| Filter pushdown translation (WHERE → connector SQL) | — | ✓ |
| Join planning | ✓ | — |
| Result aggregation | ✓ | — |
| Row serialization to client | ✓ | — |

## Shard plan per target kind

Each target kind gets a different shard strategy because the
data access pattern is different:

- **`iceberg.<ns>.<t>`** — the file list is known at plan time.
  Files get divided across eligible workers by the
  `allocate_uris_by_weight` allocator (cost-proportional, Largest
  Remainder Method). When `DATASHUTTLE_QUERY_AFFINITY=1`, each
  file prefers its rendezvous-hash-winning worker (same URI to
  same peer → warm page cache).

- **`buffer.<pipeline>`** — hard-pinned to the pipeline's
  lease-owner node. The hot buffer doesn't exist anywhere else,
  so there's no choice to make.

- **`source.<conn>.<schema>.<t>`** — re-resolves the connection
  on the worker (credentials stay local to the node the operator
  provisioned, no creds on the wire). One shard per scan today;
  future splitting by primary-key range is tracked.

- **`union.<pipeline>`** — composite: one buffer shard on the
  owner plus N iceberg shards. Coordinator dedups on PK
  (latest-wins).

## FlightExchange streaming

The coordinator's physical plan includes a
`FlightExchangeExec` for each distributed iceberg scan. DataFusion
pulls batches from it lazily: `LIMIT 10` short-circuits after the
first batch flows through, without the coordinator allocating RAM
for the rest of the scan.

The worker's side is symmetric: it drives `plan.execute()` on
its local `IcebergTableProvider` and streams batches directly
into the Flight encoder. No worker-side `collect()`; no
coordinator-side `collect()`. Memory ~= one record batch per
in-flight shard × partition.

## Cost-aware placement

Every worker gossips `NodeHealth { cpu_percent, memory_percent,
pipeline_count }`. The coordinator scores each peer:

```
cost_score = cpu_percent + memory_percent + 10 * pipeline_count
```

Lower is better. Workers sort ascending by cost; ties break
deterministically on `hash(query_id)` so retries of the same
query hit the same peers first.

URIs are distributed via the Largest Remainder Method on
`weight = max(1, 100 - cost_score)`. A cluster where every peer
has equal health splits evenly; a pathologically loaded peer
(cost_score ≥ 99) gets starved but not removed.

## Rendezvous affinity

`DATASHUTTLE_QUERY_AFFINITY=1` overlays URI→worker stickiness
on top of the cost allocator. For each URI compute
`hash(uri || 0x00 || worker_id)` — the max-scoring worker is
the preferred peer. If it's overloaded (`cost_score > 90`) the
URI falls back to the weight-based allocation over non-overloaded
peers.

HRW's low-disruption property: when a worker leaves, only URIs
whose winner was the departing worker reshuffle — so page-cache
churn is proportional to the fraction of capacity that went
away, not the whole fleet.

## Row-level security

`DATASHUTTLE_QUERY_RLS=1` enables an opt-in wrapper that injects
policy predicates into every iceberg scan at registration time.
A `CREATE ROW POLICY active_only ON iceberg.default.orders FOR
SELECT USING (status = 'active')` adds `AND status = 'active'`
to every scan of that table, via a `FilterExec` wrapping the
`IcebergTableProvider`. Policies stack (multiple `CREATE ROW
POLICY` calls AND).

In-memory only in the first cut — policies evaporate on restart.
The env gate is explicit so deployments don't enable a non-
persistent security feature accidentally.

## See also

- [Query engine concept](./query-engine.md) — mental model
- [Operator runbook](../../../runbooks/query-engine.md) —
  day-to-day
- [Cross-target joins](../sql-reference/cross-target-joins.md) —
  multi-namespace queries
- [SQL console guide](../../../operations/sql-console.md) — UI
- [ADR-0001: Distributed query engine](../../../query/adr-0001-distributed-query-engine.md) —
  original design doc
