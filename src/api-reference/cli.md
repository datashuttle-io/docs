# CLI Commands

The `datashuttle` CLI is the primary interface for managing connections, pipelines, and cluster operations.

## Server

```bash
datashuttle start                    # Start the server
datashuttle start --config path.yaml # Start with specific config
datashuttle status                   # Cluster health and pipeline summary
datashuttle version                  # Print version
```

## SQL console

```bash
datashuttle sql -e "..."             # Execute inline SQL
datashuttle sql -f file.sql          # Execute from file
datashuttle sql                      # Interactive SQL console
```

## Pipeline management

```bash
datashuttle pipeline list                    # List all pipelines
datashuttle pipeline status <name>           # Detailed status (state, lag, rows/sec)
datashuttle pipeline pause <name>            # Pause a pipeline
datashuttle pipeline resume <name>           # Resume a paused pipeline
datashuttle pipeline resnapshot <name>       # Re-load all data from source
datashuttle pipeline logs <name>             # Recent pipeline log entries
```

## Dead letters

```bash
datashuttle deadletter list <pipeline>       # List dead letter entries
datashuttle deadletter replay <pipeline>     # Replay all dead letters
datashuttle deadletter resolve <pipeline> <id>  # Resolve a specific entry
```

## GitOps

```bash
datashuttle validate -f dir/                 # Validate SQL files (dry-run)
datashuttle diff -f dir/                     # Show what would change
datashuttle apply -f dir/                    # Apply desired state
datashuttle apply -f dir/ --prune            # Apply and remove unlisted pipelines
datashuttle generate --source conn --target ns --output dir/  # Export to SQL files
```

## Output format

All commands support machine-readable output:

```bash
datashuttle pipeline list -o json            # JSON output
datashuttle pipeline list -o yaml            # YAML output
datashuttle pipeline status orders_sync -o json
```

## Global flags

| Flag | Description |
|------|-------------|
| `--config <path>` | Path to config file |
| `--host <host>` | API host to connect to (default: `localhost`) |
| `--port <port>` | API port (default: `8080`) |
| `-o json\|yaml` | Output format |
| `--log-level <level>` | Log level: `trace`, `debug`, `info`, `warn`, `error` |
