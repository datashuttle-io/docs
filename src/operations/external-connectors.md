# Adding External Connectors

OSS DataShuttle ships nine connector types out of the box (the
"Tier-1" set) — `postgres`, `greenplum`, `cockroachdb`, `vertica`,
`redshift` (in-process via `datashuttle-connector-pgfamily`), plus
`kafka`, `file`, `rest`, and `mock` as standalone sidecars. Phase 3.C
([#1031](https://github.com/evgenyestepanov-star/datashuttle/pull/1031))
moved 18 "Tier-2" connectors — MySQL, MongoDB, Snowflake, BigQuery,
Oracle, SQL Server, Cassandra, ClickHouse, Databricks, Hadoop, plus
the cloud object stores — out of the OSS workspace and into the
sibling repo
[`datashuttle-connectors-extra`](https://github.com/evgenyestepanov-star/datashuttle-connectors-extra).

This page covers what you do as an operator when you need one of
those Tier-2 connectors on your OSS install.

## How DataShuttle finds external connectors

At daemon startup the api looks for a manifest file in this order:

1. **`DS_CONNECTOR_MANIFEST` env var** — explicit override.
2. **`<DS_DATA_DIR>/connectors.json`** — user-local install (matches
   the rest of the state layout: `~/.datashuttle/connectors.json` by
   default, `/var/lib/datashuttle/connectors.json` for systemd).
3. **`/etc/datashuttle/connectors.json`** — package-installed default.

If none exist, the daemon stays on the Tier-1-only registry and logs:

```text
INFO connector supervisor: no manifest found — running Tier-1-only
```

When a manifest is found, the supervisor spawns each declared binary,
calls its `Capabilities` RPC, registers the advertised connector type
in the runtime registry, and terminates the worker. Idle workers stay
dead until a shuttle claims them
([#840](https://github.com/evgenyestepanov-star/datashuttle/issues/840)
lazy-spawn).

## Manifest schema

```json
{
  "schema_version": "1",
  "connectors": [
    {
      "connector_type": "snowflake",
      "binary": "/opt/datashuttle/connectors/datashuttle-connector-snowflake",
      "args": [],
      "env": { "RUST_LOG": "info" },
      "signature_path": null,
      "public_key_id": "datashuttle-official"
    }
  ]
}
```

Fields:

* `connector_type` — the type key the worker advertises in its
  `Capabilities` RPC. Must match — the supervisor errors at probe
  time if it doesn't.
* `binary` — absolute path to the worker executable.
* `args` — extra argv the supervisor appends on `spawn`. Most workers
  need none; the field exists for vendor-specific flags.
* `env` — env-var overrides for the worker process (the supervisor
  inherits the daemon's env and applies these on top).
* `signature_path` — detached ed25519 signature file. Defaults to
  `<binary>.sig`.
* `public_key_id` — which trust-store key verifies this binary.
  Defaults to `datashuttle-official`.

## Trust store

Every worker binary must be signed and the corresponding **public**
key must live in the trust store. Default location:
`/etc/datashuttle/trust/`, one `.pub` file per trusted signer:

```text
<key_id>:<base64-encoded-public-key>
```

The official release tarball ships
`/etc/datashuttle/trust/datashuttle-official.pub`. Operators who want
to sign their own builds (forks, internal-only connectors) generate a
new keypair and drop the public half into the trust dir.

The supervisor refuses to spawn unverified binaries — this is the
[#831](https://github.com/evgenyestepanov-star/datashuttle/issues/831)
plug-and-play security invariant.

## Installing a connector — the easy path

Use the bundled CLI; it handles signature verification, copies the
binary into the install dir, and updates the manifest atomically:

```bash
# Local file source
sudo datashuttle connectors install \
  /tmp/datashuttle-connector-snowflake \
  --connector-type snowflake \
  --signature /tmp/datashuttle-connector-snowflake.sig \
  --public-key-id datashuttle-official \
  --install-dir /opt/datashuttle/connectors \
  --manifest /etc/datashuttle/connectors.json

# HTTP(S) source (downloads + verifies in a tempdir, then copies)
sudo datashuttle connectors install \
  https://github.com/evgenyestepanov-star/datashuttle-connectors-extra/releases/download/v0.2.0/datashuttle-connector-snowflake-linux-x64 \
  --connector-type snowflake \
  --install-dir /opt/datashuttle/connectors

# Restart the daemon so the supervisor picks up the new manifest
sudo systemctl restart datashuttled
```

After restart, `GET /api/v1/connectors` returns the new entry and the
UI's connection wizard lists it alongside the Tier-1 set.

Other CLI subcommands you'll use day-to-day:

| Command | Purpose |
|---|---|
| `datashuttle connectors list` | Show installed connectors + signature status |
| `datashuttle connectors ps` | Process status of running workers |
| `datashuttle connectors logs <type>` | journalctl tail for a worker |
| `datashuttle connectors restart <type>` | Graceful SIGTERM + spawn |
| `datashuttle connectors update <type> <new-binary>` | Atomic rolling upgrade |
| `datashuttle connectors rollback <type> [--to <ts>]` | Revert to a previous archive |
| `datashuttle connectors inspect <type>` | Dump full manifest entry + signature check |
| `datashuttle connectors diag <type>` | Bundle a `.tar.gz` for bug reports |

## Installing a connector — manual path

If the CLI isn't an option (locked-down environment, custom layout,
running it as a different user), the manifest-and-trust pieces are
plain files you can lay down by hand:

```bash
# 1. Drop the binary + signature.
sudo install -D -m 755 datashuttle-connector-snowflake /opt/datashuttle/connectors/datashuttle-connector-snowflake
sudo install -D -m 644 datashuttle-connector-snowflake.sig /opt/datashuttle/connectors/datashuttle-connector-snowflake.sig

# 2. Make sure the signing key is trusted.
sudo install -D -m 644 datashuttle-official.pub /etc/datashuttle/trust/datashuttle-official.pub

# 3. Append the manifest entry.
sudo tee /etc/datashuttle/connectors.json <<'JSON'
{
  "schema_version": "1",
  "connectors": [
    {
      "connector_type": "snowflake",
      "binary": "/opt/datashuttle/connectors/datashuttle-connector-snowflake",
      "public_key_id": "datashuttle-official"
    }
  ]
}
JSON

# 4. Restart the daemon.
sudo systemctl restart datashuttled
```

## Building from source

If you maintain a fork or want to ship a connector that isn't in
[`datashuttle-connectors-extra`](https://github.com/evgenyestepanov-star/datashuttle-connectors-extra)
yet, follow the connector-author guide
[`docs/connectors/writing-your-first-connector.md`](../../../connectors/writing-your-first-connector.md).
The short version:

```bash
git clone https://github.com/evgenyestepanov-star/datashuttle-connectors-extra
cd datashuttle-connectors-extra
cargo build --release -p datashuttle-connector-snowflake

# Sign the resulting binary with your operator key.
ed25519-sign -k ~/.datashuttle/keys/operator.priv \
  -o target/release/datashuttle-connector-snowflake.sig \
  target/release/datashuttle-connector-snowflake

# Then install via the CLI as above.
```

## Verifying it worked

```bash
# Daemon log on next boot:
journalctl -u datashuttled | grep "connector supervisor"
# → INFO connector supervisor: wiring manifest manifest=/etc/datashuttle/connectors.json
# → INFO registered  connector_type=snowflake

# API surface:
curl -s :8080/api/v1/connectors | jq '.[].type_name'
# → "cockroachdb", "file", "greenplum", "kafka", "mock", "postgres",
#   "redshift", "rest", "snowflake", "vertica"
```

The connector now shows up in the UI's connection wizard and accepts
`CREATE CONNECTION snowflake_prod TYPE snowflake (…);` DDL.

## Troubleshooting

**`bootstrap failed; Tier-2 connectors will not be listed error=manifest: binary <path> does not exist`**
The path in the manifest doesn't resolve on disk. Common cause:
binary was installed for a different user or under a different prefix.

**`bootstrap failed … signature verification failed`**
Either the `<binary>.sig` is missing, the trust store doesn't contain
the public key referenced by `public_key_id`, or the binary was
modified after signing. `datashuttle connectors inspect <type>`
prints exactly which step failed.

**`bootstrap failed … protocol major skew: supervisor=N worker=M`**
The connector binary was built against an older / newer
`datashuttle-connector-protocol`. Rebuild the connector against the
same protocol crate version the OSS daemon uses (cross-check
`crates/datashuttle-connector-protocol/Cargo.toml`).

**`/api/v1/connectors` doesn't show the new connector even though
the manifest is present**
Bootstrap runs in a tokio task — racing the first `/connectors`
request is possible on slow probes. Re-issue the request after a
second; if the registration log fired, subsequent requests will see
it. If `bootstrap failed` is in the log, fix the underlying error
and restart the daemon (the bootstrap task only runs once per
process).

## See also

* [`docs/SIMPLIFICATION_PLAN.md` — Phase 3.B / 3.C](../../../SIMPLIFICATION_PLAN.md)
  for why connectors live where they do.
* [`docs/connectors/writing-your-first-connector.md`](../../../connectors/writing-your-first-connector.md)
  for the connector-author contract.
* `crates/datashuttle-connector-supervisor/src/manifest.rs` for the
  full manifest struct (every field, every default).
