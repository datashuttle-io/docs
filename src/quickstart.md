# Quickstart

Get DataShuttle running and replicate your first table in 5 minutes.

## Prerequisites

- **Docker + Docker Compose** — to run supporting infrastructure (MinIO, Polaris, PostgreSQL)
- **DataShuttle binary** — installed via any method from the [Installation](./installation/docker.md) section, or use Docker

## Step 1: Start the infrastructure

```bash
docker compose -f docker/docker-compose.yaml up -d
```

This starts:

| Service | Port | Purpose |
|---------|------|---------|
| MinIO | `:9000` | S3-compatible object storage (Iceberg warehouse) |
| Apache Polaris | `:8181` | Iceberg REST catalog with credential vending |
| PostgreSQL | `:5432` | Example source database with sample data |
| MySQL | `:3306` | Example source database |

Verify everything is healthy:

```bash
docker compose -f docker/docker-compose.yaml ps
```

## Step 2: Start DataShuttle

If you installed the binary:

```bash
datashuttle start --config datashuttle.yaml
```

Or run entirely via Docker:

```bash
docker run -p 8080:8080 --network host ghcr.io/evgenyestepanov-star/datashuttle:latest
```

The server starts on:
- `:8080` — REST API + embedded Web UI
- `:9090` — Prometheus metrics

Open <http://localhost:8080> to see the Web UI.

## Step 3: Create a source connection

```bash
datashuttle sql -e "
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

## Step 4: Create a CDC pipeline

```bash
datashuttle sql -e "
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

This single statement:
1. Creates an initial snapshot of the `orders` table
2. Starts streaming CDC changes from the PostgreSQL WAL
3. Writes Parquet data files + Puffin deletion vectors to MinIO
4. Commits to the Iceberg catalog every 30 seconds

## Step 5: Monitor the pipeline

### CLI

```bash
# Check status — shows state, rows/sec, lag, last commit
datashuttle pipeline status orders_cdc

# List all pipelines
datashuttle pipeline list

# View dead letters (rows that failed transform/write)
datashuttle deadletter list orders_cdc
```

### Web UI

Open <http://localhost:8080>:

- **Cluster Overview** — node health, aggregate throughput
- **Pipeline List** — all pipelines with lag, rows/sec, error count
- **Pipeline Detail** — per-table status, schema, pause/resume controls

### Prometheus metrics

```bash
curl -s http://localhost:8080/metrics | grep orders_cdc
```

```
datashuttle_pipeline_rows_total{pipeline="orders_cdc",table="orders"} 42000
datashuttle_pipeline_commits_total{pipeline="orders_cdc"} 84
datashuttle_pipeline_lag_seconds{pipeline="orders_cdc"} 2.1
```

## Step 6: Pipeline lifecycle operations

```bash
# Pause the pipeline (stops CDC, holds replication slot)
datashuttle sql -e "PAUSE PIPELINE orders_cdc"

# Resume from where it left off
datashuttle sql -e "RESUME PIPELINE orders_cdc"

# Re-snapshot (drops existing data, takes a fresh snapshot)
datashuttle pipeline resnapshot orders_cdc

# Drop the pipeline entirely
datashuttle sql -e "DROP PIPELINE orders_cdc"
```

## Next steps

- **Add more connectors** — [MySQL](./connectors/mysql.md), [MongoDB](./connectors/mongodb.md), [S3 files](./connectors/files.md)
- **Deploy to production** — [Deployment guide](./operations/deployment.md)
- **Set up monitoring** — [Monitoring & alerting](./operations/monitoring.md)
- **Manage pipelines as code** — [GitOps](./operations/gitops.md)
- **Learn the SQL syntax** — [SQL Reference](./sql-reference/connections.md)
