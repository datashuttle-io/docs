# Registry Backends

The DataShuttle registry stores shuttle definitions, connection
metadata, history events, and persisted metric counters. Two backends
ship with the server:

| Backend   | Default? | Use when                                      | Build feature         |
|-----------|----------|-----------------------------------------------|-----------------------|
| SQLite    | yes      | Single-node, embedded, on-prem                | (always on)           |
| PostgreSQL| no       | Clustered / HA, shared registry across nodes  | `postgres-registry`   |

Both backends expose the same `RegistryPersistence` surface, so shuttle
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
| `shuttles`        | Shuttle definitions + live fencing state            |
| `shuttle_history` | Audit log of state transitions                       |
| `metric_counters`  | Persisted per-shuttle cumulative counters           |
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

## Operator CLI — `datashuttle registry …`

The CLI ships five subcommands for working with registry state. SQLite
endpoints (`sqlite:///…`) are always supported; Postgres endpoints
(`postgres://…`) require a build with `--features postgres-registry`.

```bash
datashuttle registry --help
datashuttle registry <subcommand> --help
```

### Export a snapshot (JSON)

Portable snapshot format — use as a disaster-recovery backup, to ship
registry state between environments, or to diff what two clusters know
about:

```bash
datashuttle registry export \
    --from sqlite:///var/lib/datashuttle/registry.db \
    --out   registry-snapshot.json
```

The resulting file is a single pretty-printed JSON document containing
all connections, shuttles, history entries, metric counters, and
metric samples plus the registry version counter.

### Import a snapshot

```bash
# Dry-run first to confirm row counts:
datashuttle registry import \
    --input registry-snapshot.json \
    --to    sqlite:///tmp/target.db \
    --dry-run

# Then apply. Destination must be empty or pass --force to overwrite.
datashuttle registry import \
    --input registry-snapshot.json \
    --to    sqlite:///tmp/target.db
```

### Migrate SQLite → Postgres (or any pair)

The migrate engine runs in six phases: connect both endpoints → ensure
destination is empty → stream all data across → re-count rows on
destination → stamp `meta.migrated_from` / `meta.migrated_at` → rename
the SQLite source to `<path>.bak-<UTC-timestamp>`.

```bash
# Preview the plan — no writes, no rename:
datashuttle registry migrate \
    --from sqlite:///var/lib/datashuttle/registry.db \
    --to   postgres://ds:secret@pg.local/datashuttle \
    --dry-run

# Commit. `--yes` skips the confirm prompt; `--verify` is on by default.
datashuttle registry migrate \
    --from sqlite:///var/lib/datashuttle/registry.db \
    --to   postgres://ds:secret@pg.local/datashuttle \
    --yes
```

**Safety notes:**

- `--verify` is **on by default** — the migrate step fails (non-zero
  exit) if any row-count check mismatches between source and
  destination.
- On SQLite sources, the original `.db` file is renamed to
  `.db.bak-<timestamp>`. **Keep this backup for at least 7 days** as
  the operator-recommended rollback window.
- On Postgres sources, the migrate engine does **not** mutate the
  source — take your own `pg_dump` backup before running.
- The destination must be empty unless `--force` is passed.

### Revert from a `.bak` file

If a migration turns out to be wrong, point `revert` at the backup
file and the original SQLite destination:

```bash
datashuttle registry revert \
    --backup /var/lib/datashuttle/registry.db.bak-20260414T120000Z \
    --to     sqlite:///var/lib/datashuttle/registry.db
```

Revert is SQLite-only — to restore a Postgres registry, replay your
`pg_dump` artifact directly.

### Status

Quick health check — prints the schema version, row counts, and (on
SQLite) the last recorded `schema_migrations` entry plus any
`migrated_from` / `migrated_at` stamps:

```bash
datashuttle registry status --url sqlite:///var/lib/datashuttle/registry.db
```

[`rusqlite`]: https://docs.rs/rusqlite
[`sqlx`]: https://docs.rs/sqlx
