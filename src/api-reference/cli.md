# CLI Commands

The `datashuttle` CLI is the primary interface for managing connections, shuttles, and cluster operations.

## Server

```bash
datashuttle start                    # Start the server
datashuttle start --config path.yaml # Start with specific config
datashuttle status                   # Cluster health and shuttle summary
datashuttle version                  # Print version
```

## SQL console

```bash
datashuttle sql -e "..."             # Execute inline SQL
datashuttle sql -f file.sql          # Execute from file
datashuttle sql                      # Interactive SQL console
```

## Shuttle management

```bash
datashuttle shuttle list                    # List all shuttles
datashuttle shuttle status <name>           # Detailed status (state, lag, rows/sec)
datashuttle shuttle pause <name>            # Pause a shuttle
datashuttle shuttle resume <name>           # Resume a paused shuttle
datashuttle shuttle resnapshot <name>       # Re-load all data from source
datashuttle shuttle logs <name>             # Recent shuttle log entries
```

## Resource pools

```bash
datashuttle sql -e "CREATE SHUTTLE p1 SOURCE conn TABLE t TARGET w.ns WITH (resource_pool = 'critical')"
```

Pool management is via the REST API or Settings UI (`/api/v1/resource-pools`).

## Dead letters

```bash
datashuttle deadletter list <shuttle>       # List dead letter entries
datashuttle deadletter replay <shuttle>     # Replay all dead letters
datashuttle deadletter resolve <shuttle> <id>  # Resolve a specific entry
```

## GitOps

```bash
datashuttle validate -f dir/                 # Validate SQL files (dry-run)
datashuttle diff -f dir/                     # Show what would change
datashuttle apply -f dir/                    # Apply desired state
datashuttle apply -f dir/ --prune            # Apply and remove unlisted shuttles
datashuttle generate --source conn --target ns --output dir/  # Export to SQL files
```

## Output format

All commands support machine-readable output:

```bash
datashuttle shuttle list -o json            # JSON output
datashuttle shuttle list -o yaml            # YAML output
datashuttle shuttle status orders_sync -o json
```

## Global flags

| Flag | Description |
|------|-------------|
| `--config <path>` | Path to config file |
| `--host <host>` | API host to connect to (default: `localhost`) |
| `--port <port>` | API port (default: `8080`) |
| `-o json\|yaml` | Output format |
| `--log-level <level>` | Log level: `trace`, `debug`, `info`, `warn`, `error` |
