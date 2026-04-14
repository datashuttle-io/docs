# Registry Backends

The DataShuttle registry stores pipeline definitions, connection
metadata, history events, and persisted metric counters. Two backends
ship with the server:

| Backend   | Default? | Use when                                      | Build feature         |
|-----------|----------|-----------------------------------------------|-----------------------|
| SQLite    | yes      | Single-node, embedded, on-prem                | (always on)           |
| PostgreSQL| no       | Clustered / HA, shared registry across nodes  | `postgres-registry`   |

Both backends expose the same `RegistryPersistence` surface, so pipeline
code doesn't care which one is active. Choose based on your deployment
topology.

## When to pick which

**Pick SQLite when:**

- You run a single DataShuttle node and want zero external dependencies.
- You ship in air-gapped or constrained environments (no Postgres).
- You want the default OSS build with no extra deps (~10 MB smaller
  binary graph).

**Pick PostgreSQL when:**

- You operate a multi-node cluster and need all nodes to see a shared
  registry snapshot.
- You already run Postgres for other services (control plane, metrics)
  and want to consolidate operational surface.
- You want HA: Postgres point-in-time recovery, replication, and
  multi-AZ failover apply to registry state as well.

Under the hood, the SQLite backend uses [`rusqlite`] directly; the
Postgres backend uses [`sqlx`] with migrations applied automatically on
start.

## Configuring SQLite (default)

No configuration is required — if `registry` is absent from
`datashuttle.yaml`, SQLite at `<data_dir>/registry.db` is used. To
override the path:

```yaml
registry:
  backend: sqlite
  path: /var/lib/datashuttle/registry.db
```

`data_dir` resolves to `$DS_DATA_DIR` if set, else
`$HOME/.datashuttle`, with `/tmp/datashuttle` as a final fallback.

## Configuring PostgreSQL

**1. Rebuild with the feature enabled:**

```bash
cargo build --release --features datashuttle-core/postgres-registry
```

The default binary refuses to start if your config selects
`backend: postgres` without the feature, with a clear error. This
keeps the on-prem build sqlx-free.

**2. Set the backend in `datashuttle.yaml`:**

```yaml
registry:
  backend: postgres
  url: postgres://datashuttle:secret@db.internal:5432/datashuttle
  max_connections: 20   # optional; default 20
```

**3. Schema migrations** live in
`crates/datashuttle-core/migrations-postgres/` and are applied
automatically on connect. No manual `psql` step is required.

### Schema overview

| Table              | Purpose                                              |
|--------------------|------------------------------------------------------|
| `meta`             | Single-row registry version counter                  |
| `connections`      | Data source credentials / endpoints                  |
| `pipelines`        | Pipeline definitions + live fencing state            |
| `pipeline_history` | Audit log of state transitions                       |
| `metric_counters`  | Persisted per-pipeline cumulative counters           |
| `metric_samples`   | 7-day rolling time-series ring buffer                |

All JSON-shaped columns are stored as `JSONB` for index-friendliness.
Timestamps use `TIMESTAMPTZ`. See the migration SQL for the exact DDL.

## Running the integration tests locally

```bash
# Spin up a throwaway Postgres (Docker)
docker run --rm -d --name ds-test-pg \
  -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16

# Run the integration tests
DS_TEST_POSTGRES_URL=postgres://postgres:postgres@localhost:5432/postgres \
  cargo test -p datashuttle-core --features postgres-registry \
  --test postgres_registry
```

When `DS_TEST_POSTGRES_URL` is unset, the tests skip silently so the
default `cargo test --workspace` flow doesn't require a live DB.

## What's next

- **#572** ships `datashuttle migrate` — a dedicated CLI for upgrading
  the registry schema when DataShuttle itself bumps a migration
  version.
- **Task 2.5b** ships `datashuttle registry migrate --from
  sqlite://... --to postgres://...` with row-count verify and
  `--dry-run`, for operators moving from single-node to HA.

[`rusqlite`]: https://docs.rs/rusqlite
[`sqlx`]: https://docs.rs/sqlx
