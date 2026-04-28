# Upgrading DataShuttle

The `datashuttle migrate` command applies pending registry schema
upgrades when you bump the server binary past a release that bundles
new migrations. It is **idempotent** — running it on an already-current
database is a no-op.

Under the hood, `datashuttle migrate` dispatches to whichever backend
your registry is configured with:

| Backend    | Migration runner              | Ledger table            |
|------------|-------------------------------|-------------------------|
| SQLite     | Embedded `run_migrations()`   | `schema_migrations`     |
| Postgres   | `sqlx::migrate!()` on connect | `_sqlx_migrations`      |

Both backends also maintain the user-facing `schema_migrations` table
for tooling (`datashuttle registry status`, `datashuttle migrate
--status`). Versions match the numbered files under
`crates/datashuttle-core/migrations-postgres/` — so `007_schema_migrations`
means the same thing on either backend.

## Workflow

### Dry-run — show pending migrations

```bash
datashuttle migrate --dry-run
```

Prints the list of migrations that are *not yet* applied. On a
steady-state deployment this prints `no pending migrations (all N
applied)`.

On Postgres, sqlx migrations are applied on connect, so the dry-run
mode degrades gracefully to a status print.

### Apply pending migrations

```bash
datashuttle migrate --apply
```

This opens the registry (which is equivalent to running pending
migrations) and records each known version into the
`schema_migrations` audit table. Subsequent `--status` calls reflect
the timestamps.

### Status

```bash
datashuttle migrate --status
```

Dumps the contents of `schema_migrations` sorted by version. Use it to
confirm that a rolling upgrade picked up the new DDL on every node.

### Rollback (NOT supported)

`--rollback <N>` exists in `--help` purely so operators discover the
design position: **DataShuttle schema upgrades are roll-forward
only**. The command prints a clear error:

```
$ datashuttle migrate --rollback 1
Error: `--rollback` is not implemented — DataShuttle schema upgrades
are roll-forward only. Restore from a pre-upgrade backup if you need
to revert a migration.
```

**If you need to revert a migration,** use the backup produced by
`datashuttle registry migrate` (SQLite) or your `pg_dump` / PITR
archive (Postgres). See
[operations/registry-backends](./registry-backends.md#revert-from-a-bak-file)
for the `revert` workflow.

## Custom registry path

All subcommands accept `--url` to point at a non-default registry:

```bash
datashuttle migrate --status --url sqlite:///var/lib/datashuttle/registry.db
datashuttle migrate --apply  --url postgres://ds:secret@pg.local/datashuttle
```

Postgres URLs require a build with `--features postgres-registry` on
the CLI crate. Without the feature the command exits 2 with a
rebuild hint.

## Recommended upgrade sequence

```bash
# 1. Snapshot the registry state (disaster-recovery artifact).
datashuttle registry export \
    --from sqlite:///var/lib/datashuttle/registry.db \
    --out  /backups/ds-registry-$(date +%Y%m%d).json

# 2. Stop the server(s).
systemctl stop datashuttle

# 3. Apply pending schema migrations.
datashuttle migrate --apply

# 4. Verify.
datashuttle migrate --status
datashuttle registry status

# 5. Restart.
systemctl start datashuttle
```

Step 1 is cheap (JSON snapshot) and gives you a belt-and-braces
restore path that works across backends — you can replay it into a
fresh SQLite file with `datashuttle registry import` even if the
running Postgres instance is lost.

## Cluster rolling upgrades — version compatibility (#975)

In multi-node deployments, every gossip member publishes its binary
version (`ds:version:binary`) and wire-protocol version
(`ds:version:wire_protocol`) on self-state at startup. The cluster
enforces a `[N-1, N+1]` MAJOR window: a node whose local MAJOR is more
than 1 ahead of the cluster minimum **refuses to start** with a
diagnostic pointing at this section.

Operational implications:

* You can roll a 5-node cluster from `N` → `N+1` one node at a time —
  every intermediate state has a min MAJOR within the window.
* You **cannot** mix `N` and `N+2` in the same cluster. To jump from
  `N` to `N+2`:
  1. Walk every node through `N+1` first, **or**
  2. Drain + stop the cluster, then start every node on `N+2`.

Rollback within the window is unrestricted (no data-plane action).
Rollback past the window requires draining the misversioned nodes
first.

Full compat-matrix and bumping rules: `docs/RELEASING.md` §
"Cluster upgrade compatibility matrix".
