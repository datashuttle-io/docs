# Getting Started

This guide walks you through installing DataShuttle, starting the dev infrastructure, creating your first CDC pipeline, and verifying the data in Iceberg.

## Prerequisites

- **Rust 1.82+** — install via [rustup](https://rustup.rs/)
- **Docker + Docker Compose** — for MinIO, Nessie, PostgreSQL
- **Node.js 20+** — only if you want to modify the Web UI

## Step 1: Clone and build

```bash
git clone https://github.com/evgenyestepanov-star/datashuttle.git
cd datashuttle
cargo build --release
```

The binary is at `./target/release/datashuttle`.

## Step 2: Start dev infrastructure

```bash
docker compose -f docker/docker-compose.yaml up -d
```

This starts:
- **MinIO** on `:9000` — S3-compatible object storage (warehouse)
- **Nessie** on `:19120` — Iceberg REST catalog
- **PostgreSQL** on `:5432` — example source database
- **MySQL** on `:3306` — example source database

Verify everything is running:

```bash
docker compose -f docker/docker-compose.yaml ps
```

## Step 3: Start DataShuttle

```bash
./target/release/datashuttle start --config datashuttle.yaml
```

The server starts on:
- `:8080` — REST API + Web UI
- `:9090` — Prometheus metrics

Open http://localhost:8080 in your browser to see the Web UI.

## Step 4: Create a source connection

Using the CLI:

```bash
./target/release/datashuttle sql -e "
  CREATE CONNECTION demo_pg
    TYPE POSTGRES
    PROPERTIES (
      host = 'localhost',
      port = '5432',
      database = 'postgres',
      username = 'postgres',
      password = 'postgres'
    );
"
```

Or via the REST API:

```bash
curl -X POST http://localhost:8080/api/v1/connections \
  -H 'Content-Type: application/json' \
  -d '{"sql": "CREATE CONNECTION demo_pg TYPE POSTGRES PROPERTIES (host = '\''localhost'\'', port = '\''5432'\'', database = '\''postgres'\'', username = '\''postgres'\'', password = '\''postgres'\'')"}'
```

## Step 5: Create a CDC pipeline

```bash
./target/release/datashuttle sql -e "
  CREATE PIPELINE orders_cdc
    SOURCE demo_pg TABLE orders
    TARGET warehouse.raw
    WITH (
      mode = 'CDC',
      commit_interval = '30 seconds',
      delete_mode = 'deletion_vectors',
      schema_evolution = 'compatible'
    );
"
```

## Step 6: Monitor

### CLI

```bash
# Pipeline status
./target/release/datashuttle pipeline status orders_cdc

# List all pipelines
./target/release/datashuttle pipeline list

# View dead letters
./target/release/datashuttle deadletter list orders_cdc
```

### Web UI

Open http://localhost:8080:
- **Cluster Overview** — node health, aggregate throughput
- **Pipeline List** — all pipelines with lag, rows/sec, errors
- **Pipeline Detail** — per-table status, schema, controls

### Prometheus

Metrics available at http://localhost:8080/metrics:

```
datashuttle_active_pipelines 1
datashuttle_pipeline_rows_total{pipeline="orders_cdc",table="orders"} 42000
datashuttle_pipeline_commits_total{pipeline="orders_cdc"} 84
```

## Step 7: Pipeline lifecycle

```bash
# Pause
./target/release/datashuttle sql -e "PAUSE PIPELINE orders_cdc"

# Resume
./target/release/datashuttle sql -e "RESUME PIPELINE orders_cdc"

# Re-snapshot
./target/release/datashuttle pipeline resnapshot orders_cdc

# Drop
./target/release/datashuttle sql -e "DROP PIPELINE orders_cdc"
```

## Next steps

- [Connector Guides](connector-guides.md) — PostgreSQL, MySQL, MongoDB, S3
- [Operations Guide](operations-guide.md) — monitoring, GitOps, troubleshooting
- [API Reference](api-reference.md) — full REST API with curl examples
