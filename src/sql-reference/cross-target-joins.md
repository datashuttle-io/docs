# Cross-target joins

A single `SELECT` can `JOIN` across more than one namespace kind:
`iceberg.<ns>.<t>`, `source.<conn>.<schema>.<t>`, `buffer.<shuttle>`,
and the merged `union.<shuttle>`. This lets you align
historical-at-rest data with fresh-on-the-wire data without
staging either side.

```sql
SELECT o.id, o.status, i.sku, c.name AS customer
  FROM iceberg.default.orders o
  JOIN iceberg.default.items i ON o.id = i.id
  JOIN source.pg.public.customers c ON o.id = c.id
 WHERE o.status = 'shipped'
   AND i.quantity > 0
   AND c.region = 'EU';
```

## How it plans

Every referenced ref is resolved to a `TableProvider` on the
coordinator (Iceberg → parquet files, source → connector driver,
buffer → live Arrow Flight ring). DataFusion's own planner
composes the join tree, picks hash vs broadcast, and pushes
per-side predicates down to each provider.

Filter pushdown is declared via each provider's
`supports_filters_pushdown` return (all four providers return
`Inexact` so the planner both forwards the filter AND keeps a
safety `FilterExec` wrapper — correctness holds even when a
source driver can only translate a subset).

See the [query-engine concept doc](../concepts/query-engine.md)
for the coordinator / worker split.

## Enabling distributed fan-out

Cross-target joins run on a single coordinator by default. When
`DATASHUTTLE_QUERY_DISTRIBUTE=1` is set and the cluster has
query-capable peers, each referenced target gets its own shard
allocation: iceberg URIs fan out across workers, source scans
ship to a chosen peer, buffer reads pin to the shuttle owner.
The planner joins the streams coordinator-side.

## EXPLAIN

Prefix the query with `EXPLAIN`, or click the Explain button in
the Console toolbar. The response carries DataFusion's plan tree;
the Console's [plan viewer](../../../operations/sql-console.md)
renders it with distributed operators
(`FlightExchangeExec`, `CoalescePartitionsExec`,
`RepartitionExec`) highlighted in blue.

## Known limits

- **Pool budget accounting across refs**: today the pool budget
  tracks each ref's scan independently. A cross-target join that
  touches three refs can land three budget charges. A follow-up
  computes worst-case shard sum up-front so the budget doesn't
  double-count.
- **Join ordering for source refs**: DataFusion picks ordering
  based on schema statistics. `source.*` providers report no
  statistics today so ordering falls back to source appearance
  order in the SQL. Pin order explicitly with subqueries if
  perf matters.
- **Perf envelope**: 2×1M + 10K 3-way JOIN targets < 20s on a
  3-node cluster. Bigger than that needs either higher tier
  caps (`max_query_rows`, `max_query_bytes`) or a materialised
  shuttle.

## Related

- [Query engine concept](../concepts/query-engine.md)
- [SQL console operator guide](../../../operations/sql-console.md)
- [Query-engine runbook](../../../runbooks/query-engine.md)
