# Binary Download

Pre-built binaries are attached to every [GitHub Release](https://github.com/datashuttle-ai/datashuttle/releases), each with a SHA256 checksum file.

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
curl -LO https://github.com/datashuttle-ai/datashuttle/releases/latest/download/datashuttle-linux-amd64.tar.gz
curl -LO https://github.com/datashuttle-ai/datashuttle/releases/latest/download/datashuttle-linux-amd64.tar.gz.sha256

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

## Connector catalogue

The pre-built binary ships with the six-connector `cdc-cloud`
subset — **postgres, mysql, mongodb, kafka, file, rest-api**. This
covers the mainstream ingestion surface while keeping the binary
compact (~40-50 MB). If you need Oracle, SQL Server, Snowflake,
Databricks, Cassandra, ClickHouse, DynamoDB, Kinesis, CockroachDB,
Redshift, Greenplum, Hadoop, cloud-storage, Vertica, StarRocks or
BigQuery, build from source with the full matrix:

```bash
git clone https://github.com/datashuttle-ai/datashuttle
cd datashuttle
cargo build --release -p datashuttle-cli --features cdc-all
sudo install -m 0755 target/release/datashuttle /usr/local/bin/
```

Premium connectors will eventually gate on a license feature-flag
instead of a build flag — this opt-in is the transitional answer.

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
