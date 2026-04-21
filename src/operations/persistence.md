# Persistence

DataShuttle persists four distinct categories of state. Each has its
own durability guarantees and operator-visible surface. **Pick your
persistence mode before first boot** — several of the categories
refuse to migrate between locations without a supervised restart.

## The four persistence layers

| Layer | Location (default) | Survival |
|-------|--------------------|----------|
| **Control-plane registry** | `$DS_DATA_DIR/registry.db` (SQLite) **or** a configured Postgres URL | pipelines, connections, users, audit metadata |
| **Signing + session keys** | `$DS_DATA_DIR/crypto/` | Ed25519 audit key, archived keys, rotation log, session-invalidation marker |
| **Per-session metrics + WAL** | `$DS_DATA_DIR/time-series/`, `$DS_DATA_DIR/wal/` | Snapshots for dashboards between restarts |
| **Iceberg table + metadata files** | S3 (or compatible) + REST catalog | every row that ever went through a pipeline |

The first three live under `DS_DATA_DIR`. The fourth is entirely
external — backing up the data directory does **not** back up your
actual data (see [Backup & Restore](./backup-restore.md) for the full
story).

## `DS_DATA_DIR` — the single knob that matters

At startup DataShuttle resolves the data directory in the following
order:

1. `DS_DATA_DIR` environment variable (explicit).
2. `$HOME/.datashuttle` (for local-user runs).
3. **Panic** with an actionable message. There is no `/tmp` fallback
   — a wipe-on-reboot state directory used to silently mask broken
   systemd units and bad container `HOME=` paths, so it was removed
   in the on-prem hardening release (#801).

Recommended values by deployment mode:

| Mode | Recommended `DS_DATA_DIR` |
|------|---------------------------|
| systemd | `/var/lib/datashuttle` (auto-set by the bundled unit file via `StateDirectory=datashuttle`) |
| Docker Compose | `/var/lib/datashuttle` inside the container, backed by the `datashuttle-data` named volume |
| Kubernetes | `/data`, backed by a PVC with `storageClassName: <your RWO class>` |
| Binary dev mode | `$HOME/.datashuttle` (default) |

## Never put the data directory on tmpfs

If your process has `$DS_DATA_DIR` pointing at `/tmp/*`, the
`datashuttle doctor` command will flag it:

```
checks:
  data-dir-persistence:
    verdict: FAIL
    detail: DS_DATA_DIR=/tmp/datashuttle — tmpfs wipes on reboot.
            Set DS_DATA_DIR=/var/lib/datashuttle (systemd),
            /data (docker volume), or any non-tmpfs path.
```

The server refuses to accept a `/tmp/*` data directory because
historical incidents have traced back to it — an operator sees
DataShuttle "working" after a reboot, opens the UI, and discovers the
registry is empty because systemd re-created `/tmp` on boot.

## Registry backends

SQLite is the default. Postgres is optional and selected via config:

```yaml
registry:
  backend: postgres  # or: sqlite
  url: postgres://datashuttle:secret@localhost/datashuttle
```

See [Registry Backends](./registry-backends.md) for the migration
story between the two and [Upgrading](./upgrades.md) for how schema
migrations run against each.

## Crypto key directory

The `crypto/` subdirectory carries four files:

```
$DS_DATA_DIR/crypto/
├── ed25519.key                   # live audit signing key (mode 0600)
├── archived-keys/                # timestamped fingerprint-named archives
│   └── <fingerprint>.key
├── rotations.log                 # JSONL record of every rotation event
└── sessions_invalidated_at       # unix-ts marker written by `rotate --revoke-sessions`
```

On boot the server compares the live key fingerprint to the last
entry in `rotations.log`. A mismatch without a rotation record is
treated as a silent key swap and the server refuses to start. See
[Cryptographic Integrity](./cryptographic-integrity.md) for the full
rotation workflow.

## Backup checklist

Before declaring a persistence layer covered by DR, verify:

1. `DS_DATA_DIR` points at a mount that survives host reboot.
2. That mount is included in your snapshot schedule (LVM snapshot, EBS
   snapshot, restic backup, whatever).
3. For Postgres registry: `pg_dump` runs on the same schedule.
4. Your S3 bucket has lifecycle/versioning appropriate for the Iceberg
   retention policy.

`datashuttle backup create` assembles all three into a single
tar.zst archive — see [Backup & Restore](./backup-restore.md).
