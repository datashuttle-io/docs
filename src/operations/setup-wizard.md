# First-Run Setup Wizard

*Cross-Grade #6 (issue #567, SaaS plan phase 7.7).*

Fresh DataShuttle deployments ship with a guided five-step wizard
that takes a new operator from zero to a working shuttle ingesting
sample data in under five minutes. The wizard fires automatically
the first time the Web UI is opened and is also available from the
command line for headless installs.

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

Point your browser at the server (`http://localhost:8080/` by
default) and the app will redirect to `/setup` automatically.

### Step 1 — Admin

![Step 1 screenshot placeholder](./images/setup-step1.png)

Fill in the name, email and password of the first admin user. This
calls `POST /api/v1/auth/register` with the role implied by the
empty user store (first user is the owner). Password must be at
least 8 characters.

### Step 2 — Catalog

![Step 2 screenshot placeholder](./images/setup-step2.png)

Pick between the **in-memory catalog** (great for laptop trials,
data lives only in the process) and an **Iceberg REST** endpoint
(Nessie, Polaris, Apache Iceberg REST, etc.). The choice is
remembered and shown in the summary — you commit it to
`datashuttle.yaml` on your own in Step 5.

### Step 3 — Storage

![Step 3 screenshot placeholder](./images/setup-step3.png)

Local filesystem or S3-compatible. The wizard never prompts for
cloud credentials; those belong in `datashuttle.yaml` or env vars
and are applied on server restart.

### Step 4 — Sample data

![Step 4 screenshot placeholder](./images/setup-step4.png)

Clicking **Load 100 sample orders** issues
`POST /api/v1/setup/sample-data`. The server materializes a CSV
with 100 synthetic `orders` rows under
`$DS_DATA_DIR/sample/orders.csv` and returns the absolute path.

### Step 5 — Done

![Step 5 screenshot placeholder](./images/setup-step5.png)

Renders a summary and drops the completion marker via
`POST /api/v1/setup/complete`. Clicking **Go to Shuttles** takes
you to the normal shuttle list.

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
