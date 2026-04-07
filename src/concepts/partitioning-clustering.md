# Partitioning & Clustering

DataShuttle exposes two complementary Iceberg V3 features that control how
data is physically laid out in your tables:

| Feature | Iceberg term | DataShuttle DSL | Purpose |
|---|---|---|---|
| **Partitioning** | `partition-spec` | `PARTITION BY (...)` | Prune entire data files at scan time. |
| **Clustering / sort order** | `sort-orders[]` | `CLUSTER BY (...)` | Sort rows inside each Parquet file for locality and predicate pushdown. |

Both are declared inline in `CREATE PIPELINE`, persisted in the catalog,
and applied automatically by the writer to every snapshot the pipeline
commits. They can be added, removed, or changed on a live pipeline via
the REST API or the Web UI.

## Why two layers?

- **Partitioning** is *coarse-grained*. Iceberg uses the partition value to
  decide which data files to read at all. A query like
  `WHERE event_ts >= '2026-01-01'` against a table partitioned by
  `day(event_ts)` skips every file from earlier days without opening them.

- **Clustering** is *fine-grained*. Inside each surviving Parquet file, rows
  are physically sorted by the cluster keys, so column statistics in the
  Parquet footer are tight and predicate pushdown via min/max actually
  prunes row groups. Without sorting, min/max for a high-cardinality column
  effectively spans the entire file.

The two layers compose: partition by `day(event_ts)` to prune files, then
cluster by `(event_ts, user_id)` so that within each day's files the rows
land in time-and-user order. Predicates on either column are then served
efficiently.

## Transforms

Both `PARTITION BY` and `CLUSTER BY` accept the same set of transforms,
matching Iceberg V3 §3.2:

| Transform | Compatible types | Description |
|---|---|---|
| `identity` | any | Use the raw value. Default if no transform is given. |
| `bucket(N, col)` | int, long, string, timestamp, date | Murmur3 hash modulo N. Use for high-cardinality keys (e.g. user IDs). |
| `truncate(W, col)` | int, long, string | Integer floor or string prefix. Use for range scans on prefixes. |
| `year(col)` | date, timestamp | Calendar year extracted from a temporal column. |
| `month(col)` | date, timestamp | Months since epoch. |
| `day(col)` | date, timestamp | Days since epoch — the most common partition key for time-series. |
| `hour(col)` | timestamp | Hours since epoch — use for very high-volume tables. |

DataShuttle validates transform compatibility at parse time. A clear
error is returned if you try to apply `year(...)` to an integer column.

## SQL syntax

```sql
CREATE PIPELINE events
  SOURCE pg
  TARGET warehouse.events
  CONNECTION my_pg
  TABLES (events)
  PARTITION BY (
    day(event_ts),
    bucket(16, user_id) AS user_bucket
  )
  CLUSTER BY (
    event_ts DESC NULLS FIRST,
    user_id ASC
  )
  SCHEDULE continuous;
```

### `PARTITION BY (...)`

A comma-separated list of partition fields. Each field is one of:

- `<column>` — identity transform
- `<transform>(<args>)` — explicit transform
- `<expr> AS <name>` — explicit output partition field name

The default output name is `{column}_{transform}` (e.g. `event_ts_day`,
`user_id_bucket_16`). Override it with `AS` if you have a naming
convention or to disambiguate two partition fields on the same source
column.

### `CLUSTER BY (...)`

A comma-separated list of sort fields. Each field is one of:

- `<column>` — identity transform, ascending, default null ordering
- `<transform>(<args>)` — explicit transform
- `<expr> ASC|DESC` — explicit direction
- `<expr> ASC|DESC NULLS FIRST|LAST` — explicit null ordering

The Iceberg defaults for null ordering are:

- `ASC` → `NULLS LAST`
- `DESC` → `NULLS FIRST`

Within a Parquet file, DataShuttle sorts rows lexicographically by the
fields in the order you specify them. The first field is the primary
sort key.

## Live evolution

Both partitioning and sort order can be changed on a running pipeline
through the REST API or the Web UI. **The semantics differ**:

### Sort order — fully supported

Iceberg V3 allows appending a new sort order to an existing table without
rewriting any data. The catalog tracks every sort order ever defined, and
`default-sort-order-id` points at the current one. Old data files are left
in place; only future writes use the new order.

Trigger this from the API:

```bash
PUT /api/v1/pipelines/events/clustering
Content-Type: application/json

{
  "sort_order": {
    "fields": [
      {
        "column": "event_ts",
        "transform": "Identity",
        "direction": "Desc",
        "null_order": "NullsFirst"
      }
    ]
  },
  "apply_to_existing_tables": true
}
```

When `apply_to_existing_tables` is `true`, DataShuttle calls Iceberg
`UpdateTable` on every table the pipeline writes to, pushing the new
sort order onto the live tables. The endpoint returns
`207 Multi-Status` if any of the per-table updates fail; successful
tables are still committed.

### Partition spec — new tables only

Iceberg also supports partition spec evolution, but the data layout
implications are subtle: existing files keep their original spec ID,
queries have to merge predicates across spec versions, and a careless
change can cripple query performance. DataShuttle deliberately limits
the API to **new tables only** until we have a clearer story for safe
runtime spec changes. Updating `partition_spec` via the API stores the
new layout in the registry but does not call `UpdateTable`.

If you need to change partitioning on a live table today, the safest
path is:

1. `DROP PIPELINE` (the Iceberg table is preserved).
2. `CREATE PIPELINE` with the new `PARTITION BY` clause.
3. The pipeline's first snapshot will create a new table version with
   the new spec; reads transparently merge the old and new partition
   specs.

## Web UI

The pipeline create wizard has a **Partitioning & Clustering** section
in the Options step. Add fields with the `+` button, drag the grip
handles to reorder, pick a transform from the dropdown, and the SQL
preview underneath updates live.

The pipeline detail page shows the current clustering as a SQL block
and exposes an **Edit** modal that uses the same component. Tick
*Apply to existing tables* to push a sort-order change to the live
Iceberg tables in addition to updating the pipeline registry.

## Performance guidance

**Partitioning** is most effective when:

- Queries filter on the partition column with a predicate the engine can
  prune (`=`, `IN`, range comparisons against literal values).
- The partition has reasonable cardinality — too few partitions and
  pruning gives little benefit, too many and metadata bloats. Aim for
  ~thousands per table.
- The partition column has high write locality. `day(event_ts)` is
  ideal for time-series; `bucket(16, user_id)` is ideal for
  user-keyed tables.

**Clustering** is most effective when:

- Queries filter on the sort column with high selectivity.
- The sort column has many distinct values per file. Identity sorts on
  high-cardinality columns benefit the most.
- File sizes are reasonably large (>100 MB) so each file contains many
  row groups whose stats can be pruned independently.

**Common combinations:**

| Use case | Partition | Cluster |
|---|---|---|
| Event logs | `day(event_ts)` | `(event_ts ASC, user_id ASC)` |
| User-keyed table | `bucket(16, user_id)` | `(user_id ASC)` |
| Geographic data | `truncate(2, country_code)` | `(country_code, region)` |
| Wide-fanout joins | none | `(join_key ASC)` |

When in doubt, partition by `day(event_ts)` (or hour for very high
volume) and cluster by your most common filter column. Tune from there
based on actual query patterns.

## Migration from earlier versions

Pipelines created before the partitioning-and-clustering feature
landed default to **unpartitioned, unsorted**. The default `sort-order-id`
in their `metadata.json` is `0` (the reserved unsorted slot), and
`partition-specs[0].fields` is empty. They continue to work without
modification.

To opt in:

1. Open the pipeline in the Web UI → **Edit** under
   *Partitioning & Clustering*, configure the layout, optionally tick
   *Apply to existing tables*, and save.
2. Or via SQL: `DROP PIPELINE` (table is preserved) and re-create with
   the new clauses. The next snapshot will reuse the existing data files
   with the legacy spec; only new commits use the new layout.
3. Or via API: `PUT /api/v1/pipelines/:name/clustering` with the
   structured body — see the
   [REST reference](../api-reference/rest.md#pipeline-clustering).

The legacy `WITH (partition_spec = '...', sort_order = '...')` string
options are still accepted by the parser for backward compatibility.
They are parsed into the same structured AST as the native clauses, so
no behavioural difference at runtime — but the native syntax is
recommended for new pipelines because it gets type-checked.

## Background

- [Iceberg spec §3 — Partitioning](https://iceberg.apache.org/spec/#partitioning)
- [Iceberg spec §3.2 — Sort orders](https://iceberg.apache.org/spec/#sort-orders)
