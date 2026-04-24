# Query engine — SQL reference

Index into every SQL surface DataShuttle's query engine exposes.
Each target namespace has its own semantics; this page is the
map.

## Namespaces

```sql
-- 1. Upstream source table — hits the connector driver directly.
SELECT * FROM source.<connection>.<schema>.<table>;

-- 2. Cold iceberg snapshot — committed parquet files.
SELECT * FROM iceberg.<namespace>.<table>;

-- 3. Hot buffer — live Arrow Flight ring for a running pipeline.
SELECT * FROM buffer.<pipeline>;

-- 4. Union — iceberg ∪ buffer, dedup latest-wins on PK.
SELECT * FROM union.<pipeline>;
```

Pick one per reference; you can mix them within a single query —
see [cross-target joins](./cross-target-joins.md).

## Examples

### Source — peek before a pipeline exists

```sql
-- Row count on a live Postgres table without touching Iceberg.
SELECT COUNT(*) FROM source.pg_prod.public.orders;

-- Narrow a schema check — picks up connector's WHERE pushdown
-- (postgres today; other dialects fall back to DataFusion-side
-- filtering).
SELECT id, status
  FROM source.pg_prod.public.orders
 WHERE status = 'pending' AND created_at > NOW() - INTERVAL '1 hour';
```

### Iceberg — stable historical

```sql
-- Everything the warehouse has committed.
SELECT date_trunc('day', commit_at) AS d, COUNT(*) AS rows
  FROM iceberg.warehouse.orders
 GROUP BY 1 ORDER BY 1 DESC LIMIT 30;

-- Iceberg time-travel by snapshot id (FOR VERSION AS OF).
SELECT COUNT(*) FROM iceberg.warehouse.orders FOR VERSION AS OF 4827512342;
```

### Buffer — sub-second freshness

```sql
-- Latest rows from a running pipeline's in-memory buffer.
SELECT id, status, event_at
  FROM buffer.orders_live
 ORDER BY event_at DESC LIMIT 20;
```

### Union — fresh + complete

```sql
-- Default for operational dashboards: committed data + anything
-- the buffer hasn't flushed yet, deduplicated by PK.
SELECT status, COUNT(*)
  FROM union.orders_live
 GROUP BY 1 ORDER BY 2 DESC;
```

### Cross-target — three namespaces in one query

```sql
SELECT o.id, i.sku, c.name
  FROM iceberg.warehouse.orders o
  JOIN source.pg_prod.public.customers c ON o.customer_id = c.id
  JOIN buffer.live_inventory i ON o.sku = i.sku
 WHERE o.status = 'shipped';
```

See [cross-target-joins](./cross-target-joins.md) for planning
details.

### EXPLAIN

```sql
-- Raw SQL variant.
EXPLAIN SELECT id FROM iceberg.warehouse.orders WHERE status = 'active';
```

Or use the Console's Explain button — renders the plan tree with
distributed operators highlighted.

## Row-level security

`CREATE ROW POLICY <name> ON iceberg.<ns>.<t> FOR SELECT USING (<expr>)`
registers a predicate; every subsequent SELECT against the table
gets the predicate AND-ed into the scan when
`DATASHUTTLE_QUERY_RLS=1` is set. See the
[query-engine runbook](../../../runbooks/query-engine.md)
for operator mechanics.

## Environment flags

| Flag | Default | Effect |
|------|---------|--------|
| `DATASHUTTLE_QUERY_DISTRIBUTE` | off | Coordinator fans scans out to remote workers via Flight. |
| `DATASHUTTLE_QUERY_AFFINITY` | off | URI → worker rendezvous-hash affinity. Requires `DISTRIBUTE=1`. |
| `DATASHUTTLE_QUERY_RLS` | off | Enforce registered row policies. Experimental — in-memory. |

## Tier quotas

Each BillingPlan caps query behaviour per tenant:

| Tier | Rows | Bytes | Seconds | Concurrent |
|------|------|-------|---------|------------|
| Community | 100k | 512 MB | 30s | 2 |
| Team | 10M | 10 GB | 300s | 10 |
| Business | ∞ | ∞ | 3600s | 50 |
| Enterprise | ∞ | ∞ | ∞ | 200 |

A query that hits a row or byte cap mid-stream surfaces with
`SqlResult.truncated = true`; the Console renders a red ⛔
banner.

## Related

- [Query engine concept](../concepts/query-engine.md) — mental model
- [Distributed queries](../concepts/distributed-queries.md) — execution story
- [Cross-target joins](./cross-target-joins.md)
- [SQL console operator guide](../../../operations/sql-console.md)
- [Query-engine runbook](../../../runbooks/query-engine.md)
