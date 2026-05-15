# Binary Download

Pre-built binaries are attached to every [GitHub Release](https://github.com/datashuttle-io/datashuttle/releases), each with a SHA256 checksum file.

## Quick install (recommended)

The install script detects your OS and architecture, downloads the binary, verifies the checksum, and installs to `/usr/local/bin`:

```bash
curl -fsSL https://datashuttle.ai/install.sh | bash
```

### Options

```bash
# Install a specific version
curl -fsSL ... | bash -s -- --version v0.1.0

# Install to a custom directory
curl -fsSL ... | bash -s -- --install-dir ~/.local/bin

# Or set via environment variables
DATASHUTTLE_VERSION=v0.1.0 DATASHUTTLE_INSTALL_DIR=~/.local/bin bash install.sh
```

## Available platforms

| Platform | Archive |
|----------|---------|
| Linux x86_64 | `datashuttle-linux-amd64.tar.gz` |
| Linux ARM64 | `datashuttle-linux-arm64.tar.gz` |
| macOS ARM64 (Apple Silicon) | `datashuttle-macos-arm64.tar.gz` |

## Manual download and install

```bash
# Download binary + checksum
curl -LO https://github.com/datashuttle-io/datashuttle/releases/latest/download/datashuttle-linux-amd64.tar.gz
curl -LO https://github.com/datashuttle-io/datashuttle/releases/latest/download/datashuttle-linux-amd64.tar.gz.sha256

# Verify integrity
sha256sum -c datashuttle-linux-amd64.tar.gz.sha256

# Extract and install
tar xzf datashuttle-linux-amd64.tar.gz
sudo mv datashuttle /usr/local/bin/
```

## Verify

```bash
datashuttle --version
datashuttle --help
```

## Thin client vs. full daemon

Since #816 releases ship two flavours of binary:

| Binary | Intended audience | Size (stripped) | Notes |
|---|---|---|---|
| `datashuttle-client` | Developer workstations | ~15-25 MB | Talks to a remote daemon over HTTP. No server, no connector drivers, no embedded UI. Set `DS_SERVER` env var or pass `--server http://host:3000`. |
| `datashuttle` / `datashuttled` | Operators running the cluster | ~150 MB | Identical contents; `datashuttled` is the daemon-flavoured alias under systemd / launchd. Includes every CLI command (backup, crypto rotate, registry migrate, doctor, …). After Phase 7.2 (#831 epic) the api binary contains zero connector driver code — it spawns the matching sidecar binary on first shuttle. |
| `datashuttle-connector-<X>` | Required next to `datashuttled` (×22) | ~10 MB each | One sidecar binary per connector type. The release tarball + Debian/RPM packages place these under `/usr/lib/datashuttle/connectors/`. Lazy-spawned — only the connectors a shuttle references ever start; reaped after 10 min idle. |

Developer install example:

```bash
# On the dev workstation — talk to the production daemon over HTTPS.
curl -fsSL https://datashuttle.ai/install.sh | bash -s -- --client-only
export DS_SERVER=https://datashuttle.example.com
datashuttle-client status
datashuttle-client shuttle list
```

Operator install example — same as before, ships `datashuttle` +
`datashuttled`:

```bash
curl -fsSL https://datashuttle.ai/install.sh | sudo bash -s -- --systemd
```

## Connector catalogue

After Phase 7.2 (#831 epic, closed 2026-04-25) the release tarball
ships **all 22 connectors** as separate sidecar binaries — postgres,
mysql, mongodb, kafka, file, rest-api, cockroachdb, greenplum,
vertica, redshift, starrocks, snowflake, bigquery, databricks,
sqlserver, oracle, cassandra, dynamodb, kinesis, clickhouse, hadoop,
cloud-storage. The `cdc-cloud` / `cdc-all` build-time split is gone
— what gates a connector at runtime is whether its sidecar binary is
on the host, not what the api was compiled with.

The api binary itself stays slim (~150 MB; pre-Phase-7.2 was 173 MB
with drivers in-process) and lazy-spawns sidecars only when a
shuttle references them. Idle workers get reaped after 10 minutes.

Building from source:

```bash
# Source tarball for the latest release (SHA256 available alongside).
curl -LO https://datashuttle.ai/releases/latest/datashuttle-source.tar.gz
tar xzf datashuttle-source.tar.gz
cd datashuttle-*

# Build the api + cli.
cargo build --release -p datashuttle-cli
sudo install -m 0755 target/release/datashuttle /usr/local/bin/

# Build the 22 sidecars and install next to the api.
./scripts/build-sidecars.sh --all
sudo mkdir -p /usr/lib/datashuttle/connectors
for c in postgres mysql mongodb kafka file rest-api \
         cockroachdb greenplum vertica redshift starrocks \
         snowflake bigquery databricks sqlserver oracle \
         cassandra dynamodb kinesis clickhouse hadoop cloud-storage; do
    sudo install -m 0755 target/release/datashuttle-connector-$c \
        /usr/lib/datashuttle/connectors/
done
```

Premium connectors gate on a license feature-flag at runtime — the
sidecar binary refuses to spawn for unlicensed types.

## Install as a systemd service

Add `--systemd` to the install-script invocation (or to a manual
install) to drop a hardened unit file under `/etc/systemd/system/`:

```bash
curl -fsSL https://datashuttle.ai/install.sh | sudo bash -s -- --systemd
```

This creates a dedicated `datashuttle` system user, `StateDirectory=datashuttle`
(which maps `DS_DATA_DIR=/var/lib/datashuttle`), and enables the hardening
flags appropriate for a network service (`ProtectSystem=strict`,
`SystemCallFilter=@system-service`, `NoNewPrivileges=true`).

Bring it up:

```bash
sudo -u datashuttle datashuttle setup --quickstart --config /etc/datashuttle/datashuttle.yaml
sudo systemctl enable --now datashuttle
```

## Required environment

DataShuttle needs a persistent data directory. Resolution order:

1. `DS_DATA_DIR` env var if set (recommended for systemd / containers).
2. `$HOME/.datashuttle` if `HOME` is a real writable path.
3. Otherwise startup **panics** — there is no `/tmp` fallback because
   a wipe-on-reboot directory has historically masked broken
   deployments.

For a bare `datashuttle start` outside systemd, either export the var
explicitly:

```bash
export DS_DATA_DIR=/var/lib/datashuttle
sudo mkdir -p "$DS_DATA_DIR" && sudo chown "$USER" "$DS_DATA_DIR"
datashuttle start --config /etc/datashuttle/datashuttle.yaml
```

…or run under a user whose `$HOME` is a real directory (the default
for interactive shells).

## Verify the install

```bash
datashuttle doctor --config /etc/datashuttle/datashuttle.yaml
```

Runs eight offline filesystem checks (config parses, data dir is
writable and not on tmpfs, crypto key mode 0600, registry present, …)
and prints a color-coded summary. See the CLI reference for the full
check list.
