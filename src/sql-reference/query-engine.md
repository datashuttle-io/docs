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
-- 1. Row count on a live Postgres table without touching Iceberg.
SELECT COUNT(*) FROM source.pg_prod.public.orders;

-- 2. Narrow a schema check — picks up connector's WHERE pushdown.
SELECT id, status
  FROM source.pg_prod.public.orders
 WHERE status = 'pending' AND created_at > NOW() - INTERVAL '1 hour';

-- 3. Compare upstream against warehouse after a CDC cutover.
SELECT COUNT(*) FROM source.pg_prod.public.orders
 WHERE updated_at > NOW() - INTERVAL '5 minutes';

-- 4. Inspect a Mongo collection via connector pass-through.
SELECT _id, status FROM source.mongo_ops.products.inventory LIMIT 20;

-- 5. Kafka latest-offset peek (connector exposes offset columns).
SELECT partition, offset, value
  FROM source.kafka_analytics.default.events
 ORDER BY offset DESC LIMIT 10;
```

### Iceberg — stable historical

```sql
-- 1. Everything the warehouse has committed.
SELECT date_trunc('day', commit_at) AS d, COUNT(*) AS rows
  FROM iceberg.warehouse.orders
 GROUP BY 1 ORDER BY 1 DESC LIMIT 30;

-- 2. Iceberg time-travel by snapshot id.
SELECT COUNT(*) FROM iceberg.warehouse.orders FOR VERSION AS OF 4827512342;

-- 3. Cross-table join — committed orders × committed customers.
SELECT o.id, c.email
  FROM iceberg.warehouse.orders o
  JOIN iceberg.warehouse.customers c ON o.customer_id = c.id
 WHERE o.status = 'shipped';

-- 4. Aggregations on a partition column — planner uses pruning.
SELECT region, SUM(amount_cents) / 100.0 AS gross
  FROM iceberg.warehouse.orders
 WHERE order_date >= DATE '2026-01-01'
 GROUP BY 1;

-- 5. Last N iceberg commits ring-buffer.
SELECT * FROM iceberg.warehouse.orders
 WHERE commit_at > NOW() - INTERVAL '24 hours'
 ORDER BY commit_at DESC LIMIT 100;
```

### Buffer — sub-second freshness

```sql
-- 1. Latest rows from a running pipeline's in-memory buffer.
SELECT id, status, event_at
  FROM buffer.orders_live
 ORDER BY event_at DESC LIMIT 20;

-- 2. Row count in the hot buffer — "how many rows behind the
--    last iceberg commit am I?".
SELECT COUNT(*) FROM buffer.orders_live;

-- 3. Freshness probe: max timestamp in the buffer.
SELECT MAX(event_at) AS newest FROM buffer.orders_live;

-- 4. Status histogram for a live pipeline.
SELECT status, COUNT(*) FROM buffer.orders_live GROUP BY status;

-- 5. Pick up a specific row by PK for "did my INSERT land?".
SELECT * FROM buffer.orders_live WHERE id = 42;
```

### Union — fresh + complete

```sql
-- 1. Default for operational dashboards: committed + buffer,
--    dedup latest-wins.
SELECT status, COUNT(*) FROM union.orders_live GROUP BY 1 ORDER BY 2 DESC;

-- 2. 7-day revenue — works across the iceberg/buffer boundary.
SELECT date_trunc('day', order_at) AS d, SUM(amount_cents)/100.0 AS gross
  FROM union.orders_live
 WHERE order_at >= NOW() - INTERVAL '7 days'
 GROUP BY 1 ORDER BY 1;

-- 3. Fresh top-10 with deduplication handled for you.
SELECT * FROM union.orders_live ORDER BY event_at DESC LIMIT 10;

-- 4. Unioned aggregation that a naive `buffer` query would miss
--    for iceberg-only rows older than the buffer TTL.
SELECT region, COUNT(*) FROM union.orders_live GROUP BY region;

-- 5. Freshness probe across the union — newest PK wins.
SELECT id, MAX(updated_at) FROM union.orders_live GROUP BY id
 ORDER BY 2 DESC LIMIT 20;
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

## Column masking

```sql
CREATE COLUMN MASK <name> ON <ref>.<column> USING (<expr>)
```

Replaces a column's value at scan time with the result of a SQL
expression. Output schema preserves the original column name and
type, so a join on the masked column still works — every row sees
the masked value. Common shapes:

```sql
-- Constant redaction
CREATE COLUMN MASK redact_email ON iceberg.default.users.email
  USING ('***');

-- Conditional, branching on a sibling column
CREATE COLUMN MASK region_aware ON iceberg.default.users.email
  USING (CASE WHEN region = 'us' THEN email ELSE '***' END);
```

`<ref>` accepts the same three namespaces as row policies
(`iceberg.<ns>.<table>`, `buffer.<pipeline>`,
`source.<conn>.<schema>.<table>`). Drop with
`DROP COLUMN MASK [IF EXISTS] <name> ON <ref>.<column>`.

Activation is behind `DATASHUTTLE_QUERY_MASK=1` (parallel to RLS's
own flag — operators can land masking and row policies
independently). When the flag is on, every SELECT against a
masked ref runs the mask expression; off, masks persist but don't
fire. Persistence is identical to row policies (#16): SQLite +
catalog backends store masks across restarts.

Composition with RLS: row policies filter rows first, then masks
transform the surviving columns. The reverse order would let
policies branch on masked values, which would surprise authors —
`status = 'active' AND email LIKE '%@bigco.com'` mustn't silently
match nothing if `email` is already `'***'` for the policy author.

## Row-level security

```sql
CREATE ROW POLICY <name> ON <ref> FOR SELECT USING (<expr>)
```

`<ref>` is any of:
- `iceberg.<ns>.<table>` — cold snapshot
- `buffer.<pipeline>` — hot Flight buffer
- `source.<connection>.<schema>.<table>` — connector pass-through

Policies registered against one namespace do **not** apply to the
others — a policy on `buffer.orders_live` is not honoured for
`iceberg.warehouse.orders_live` even though they typically share
the same underlying table. Register policies against every
namespace your users will query.

Every subsequent SELECT against the registered ref gets the
predicate AND-ed into the scan when `DATASHUTTLE_QUERY_RLS=1` is
set. Distributed scans push predicates into the shard ticket, so
iceberg and buffer workers filter rows **before** the Flight
encode — pushdown is a throughput optimisation; coordinator-side
RLS still runs unconditionally, so an older worker that ignores
the field stays correct. Source shards are filtered coordinator-
side (worker-side source streaming bypasses the provider plan).
See the [query-engine runbook](../../../runbooks/query-engine.md)
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
