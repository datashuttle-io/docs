# First-Run Setup Wizard

*Cross-Grade #6 (issue #567, SaaS plan phase 7.7). Unified `/welcome`
shell since #672. Catalog/storage/sample-data fields became
no-longer-no-ops after the cleanup commit that ships alongside this
doc revision.*

Fresh DataShuttle deployments ship with a guided wizard at
`http://localhost:8080/welcome` that takes a new operator from zero
to a working shuttle ingesting sample data in under five minutes.
The wizard fires automatically the first time the Web UI is opened
and is also available from the command line for headless installs.
Legacy `/setup` and `/onboarding` URLs 301 to `/welcome`.

## When does the wizard run?

A deployment is considered "first-run" when **both** of the
following are true:

- The registry contains zero shuttles.
- The control-plane user store contains zero users.

The probe is served by `GET /api/v1/setup/state`, which returns JSON:

```json
{ "first_run": true, "completed_steps": [], "current_step": "admin" }
```

The endpoint is deliberately cheap — single `AtomicBool` load on
`AppState` — so the UI can hit it on every app boot without
measurable overhead. The cache is invalidated when:

- Any shuttle is created.
- Any user is registered.
- The operator POSTs `/api/v1/setup/complete`.
- The on-disk marker (`$DS_DATA_DIR/setup_completed_at`) is
  observed.

Any of the above flips `first_run` to `false` permanently for the
lifetime of that deployment.

## UI walk-through

The wizard renders up to six steps. Some are skipped based on the
detected `deployment.kind` (see
[`WelcomePage.tsx`](https://github.com/datashuttle-io/datashuttle/blob/main/ui/src/pages/WelcomePage.tsx)
for the visibility predicate).

### Step 1 — Welcome

A short orientation screen tailored to the detected deployment kind
(`solo`, `airgapped`, `enterprise_sso`, `cloud`, or generic
self-hosted). No form fields.

### Step 2 — Account *(hidden for `cloud`, `enterprise_sso`, `solo`)*

Admin email, display name, password (≥ 8 chars). Cloud signup
collects this on the marketing site instead; SSO deployments
delegate to the IdP; solo installs run with `auth.mode=none`.

### Step 3 — Organization

Workspace name (shown in sidebar + invite emails). Cloud tenants
also pick a plan tier — `community` / `team` / `business` /
`enterprise`. Self-hosted hands tier through the license file.

### Step 4 — Catalog & storage *(hidden for `cloud`)*

Catalog choice maps to `storage.catalog_type` in `datashuttle.yaml`:

| Wizard option | Persists as |
|---|---|
| In-memory | (default — REST/Polaris on `localhost:8181`) |
| Hive Metastore | `hive` |
| Polaris | `rest` |
| AWS Glue | `glue` |

Storage choice maps to `storage.storage_type`:

| Wizard option | Persists as |
|---|---|
| Local file system | (default — built-in local FS adapter) |
| S3 / GCS / MinIO | `s3` / `gcs` / `minio` |
| Azure Blob | `adls` |

The wizard never prompts for cloud credentials — those belong in
env vars or the Settings → Storage UI. Catalog and storage take
effect on the **next daemon restart**; the runtime catalog/storage
adapter does not hot-reload. The post-Finish toast tells you
whether the choice was persisted (`storage_config_persisted=true`)
or dropped because no `--config` path was set.

### Step 5 — First connection

Pick a source kind (Sample / PostgreSQL / MySQL / MongoDB / S3) and
optionally tick "Pre-seed a sample Iceberg namespace on first boot".
Both signals materialize the sample CSV under
`$DS_DATA_DIR/sample/orders.csv` (100 rows of synthetic orders) on
the server and stash the path in `sessionStorage` for the shuttle
wizard. The kind itself is forwarded to
`/shuttles/new?connection_kind=<kind>` so the next page lands with
the right source preset.

### Step 6 — Ready

Confirmation screen. Clicking **Finish** posts the full
`WizardPayload` to `POST /api/v1/setup/complete`, which atomically:

1. Creates the admin user + org + owner membership.
2. Mints a session JWT (stashed in `sessionStorage` so RequireAuth
   passes without a `/login` round-trip).
3. Persists `catalog` / `storage` to `datashuttle.yaml`.
4. Materializes the sample CSV when requested.
5. Writes `$DS_DATA_DIR/setup_completed_at`.

The UI then routes to `/shuttles/new` (with `?connection_kind=` set
when the operator picked a non-sample source).

## Skip link

Every step shows a **Skip wizard** link in the footer. It POSTs
`/setup/complete` and drops you on the Shuttles page. Use it when
you already have a YAML config prepared and don't want the built-in
sample data.

## CLI quickstart

For headless installs (K8s, cloud-init, Docker bootstrap), use the
CLI:

```sh
datashuttle setup --quickstart
```

Defaults used in quickstart mode:

| Setting        | Default                              |
|----------------|--------------------------------------|
| Admin email    | `admin@example.com`                  |
| Admin password | 24 random URL-safe characters, printed once |
| Catalog        | `in-memory`                          |
| Storage        | Local filesystem at `$DS_DATA_DIR`   |
| Sample data    | Loaded                               |

Example output:

```text
$ datashuttle setup --quickstart
Quickstart mode: using admin email admin@example.com (password printed below).
Wrote datashuttle.yaml (minimal template).
Sample dataset materialized at /root/.datashuttle/sample/orders.csv (100 rows).
Setup complete (marker written to /root/.datashuttle/setup_completed_at, stamp=2026-04-14T12:34:56Z).

→ Admin email:    admin@example.com
→ Admin password: dK3v9m-aXp7Qz8_2rTy6H4B1
(printed once — copy now.)
```

Interactive mode is the default — drop the `--quickstart` flag to
get prompted for every field.

## Re-running the wizard

The marker file is idempotent: re-running `datashuttle setup` is a
no-op and exits `2` until the marker is removed. Two ways to reset:

```sh
# 1. CLI helper:
datashuttle setup --reset

# 2. Delete the file manually:
rm "$DS_DATA_DIR/setup_completed_at"
```

After reset, the next UI visit or CLI invocation will show the
wizard again.

## Security notes

- The three wizard endpoints (`/setup/state`, `/setup/complete`,
  `/setup/sample-data`) are exempt from the authentication
  middleware — a fresh deployment has no admin yet, so the UI must
  be able to reach them without credentials. Once the cache flips
  to `false` they become effective no-ops.
- The sample CSV is emitted by the server process directly; no
  external service or credentials are involved.
- `--quickstart` prints the generated password to stdout exactly
  once. Capture it in the same shell invocation or rotate it from
  the Settings page afterwards.

## Related reading

- [Quickstart](../quickstart.md) — follow this after the wizard
  finishes.
- [Configuration](../concepts/configuration.md) — how to persist
  the catalog/storage choices the wizard recorded.
- [Local Auth Mode](./auth-local.md) — alternative to the
  password-based admin user the wizard creates.
