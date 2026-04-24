# SQL Console

Day-to-day operator surface for running ad-hoc queries against
source systems, Iceberg snapshots, hot buffers, and the union of
both. Routed at `/sql` in the web UI.

## Target picker (#857)

A four-way segmented selector sits at the top of the editor next
to the Hot/Cold toggle:

| Target  | What it reads | Best for |
|---------|---------------|----------|
| Source  | Rows live in an upstream connector (Postgres, MySQL, Kafka, file, REST). Each SELECT translates into a connector-driver scan. | Ad-hoc peek into production data before building a pipeline. |
| Iceberg | Committed Iceberg snapshots from the warehouse. Served via the object store with partition/file pruning. | Stable historical queries; cross-pipeline joins; consistency > freshness. |
| Buffer  | The in-memory Arrow Flight ring buffer for a live pipeline. Reflects whatever has arrived from the source but hasn't been committed to Iceberg yet. | Sub-second freshness; "did my last INSERT land?" checks. |
| Union   | Iceberg ∪ Buffer, deduplicated latest-wins by the pipeline's PK. **Default.** | Fresh *and* complete — what most operational dashboards want. |

The picker is **advisory**: it scopes the SQL auto-complete and
tags the request body, but the executor still honours the actual
namespaces in your SQL text. So a query prefixed
`SELECT * FROM iceberg.default.orders` runs against the Iceberg
namespace regardless of which target pill is highlighted — the
picker just signals what the editor should suggest next.

Keyboard-navigable (Tab moves between pills; Space/Enter
activates). `aria-pressed` reflects the active target.

## Explain button (#857)

Next to the target picker. Clicking it re-runs the current SQL
with `?explain=1` — the response carries the DataFusion plan
tree instead of rows, and the result pane swaps from the flat
table to the `PlanViewer` component. Distributed operators
(`FlightExchangeExec`, `CoalescePartitionsExec`, `RepartitionExec`)
are highlighted in blue so the fan-out boundary is visually
obvious.

Typing `EXPLAIN SELECT …` by hand still works — the button is a
convenience on top of the existing `?explain=1` surface.

## Result footer

After every query the footer shows five pieces of information:

- **Source pill** — coloured by kind (`iceberg` / `flight` /
  `registry` / `error`). `iceberg-distributed` means the coordinator
  fanned out; `flight-iceberg-fallback` means a hot-buffer query
  fell back to the iceberg layer.
- **Duration** — wall-clock ms the server took.
- **Row count** — how many rows the response carries.
- **Distributed footnote** — when a scan fanned out, a ⇄ pill
  labelled `fanned: N workers (kind)`. Hover for the full list;
  click to deep-link into the worker's health row on
  `/cluster#node-<id>` (single-worker scans) or the dashboard
  (multi-worker).
- **Truncated banner** — red ⛔ pill when the executor stopped
  before the query finished (hit a tier budget on
  `max_query_rows` / `max_query_bytes` / `max_query_seconds`).
  Results shown are partial.
- **Warnings** — everything else (buffer fallback notes,
  permission hints, etc.) as a single ⚠ line with the rest on
  hover.

## Env flags worth knowing

| Flag | Default | What it enables |
|------|---------|-----------------|
| `DATASHUTTLE_QUERY_DISTRIBUTE` | off | Coordinator fans iceberg / buffer / source scans out to remote workers via Flight. |
| `DATASHUTTLE_QUERY_AFFINITY` | off | Rendezvous-hash URI→worker affinity. Same URI to same peer — page cache stays warm. Requires `DISTRIBUTE=1`. |
| `DATASHUTTLE_QUERY_RLS` | off | Enforce registered row policies. Experimental — in-memory only. |

See the [query-engine runbook](../../../runbooks/query-engine.md)
for the operator playbook and
[concepts/query-engine](../concepts/query-engine.md) for
architecture.

## Keyboard shortcuts

- **Cmd/Ctrl + Enter** — run the current statement.
- **Cmd/Ctrl + Shift + Enter** — run selection or buffer as
  multi-statement.
- **Cmd/Ctrl + Shift + R** — dry-run (parse-only validation).
- **Cmd/Ctrl + K** — open the command palette.
- **?** — toggle the cheat sheet.
