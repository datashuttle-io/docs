# Getting Started

This guide walks you through installing DataShuttle, starting the dev infrastructure, creating your first CDC pipeline, and verifying the data in Iceberg.

For installation options, see [Installation](./installation.md).

## Prerequisites

For the quickstart below you need **Docker + Docker Compose** to run the supporting infrastructure (MinIO, Polaris, Postgres, MySQL). DataShuttle itself can be installed by any method from the Installation page.

## Step 1: Start dev infrastructure

```bash
docker compose -f docker/docker-compose.yaml up -d
```

This starts:
- **MinIO** on `:9000` — S3-compatible object storage (warehouse)
- **Apache Polaris** on `:8181` — Iceberg REST catalog (with credential vending)
- **PostgreSQL** on `:5432` — example source database
- **MySQL** on `:3306` — example source database

Verify everything is running:

```bash
docker compose -f docker/docker-compose.yaml ps
```

## Step 2: Start DataShuttle

```bash
datashuttle start --config datashuttle.yaml
```

Or with Docker:

```bash
docker run -p 8080:8080 --network host ghcr.io/evgenyestepanov-star/datashuttle:latest
```

The server starts on:
- `:8080` — REST API + embedded Web UI
- `:9090` — Prometheus metrics

Open http://localhost:8080 in your browser to see the Web UI.

## Step 3: Create a source connection

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

## Step 4: Create a CDC pipeline

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

## Step 5: Monitor

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

## Step 6: Pipeline lifecycle

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
