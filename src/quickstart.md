# Quickstart

Get DataShuttle running and replicate your first table in 5 minutes.

## Prerequisites

> **Prefer a binary?** Download the latest release from [GitHub Releases](https://github.com/evgenyestepanov-star/datashuttle/releases/latest) and skip Docker for DataShuttle itself. You will still need Docker for Polaris and MinIO.

- **Docker** and **Docker Compose** (v2)

That's it. Everything runs in containers.

## Step 1: Start the stack with a demo database

Download the packaged demo bundle and start DataShuttle with the full
demo environment (PostgreSQL with sample data + Polaris + MinIO):

```bash
# Grab the demo compose bundle from the latest release
curl -LO https://github.com/evgenyestepanov-star/datashuttle/releases/latest/download/datashuttle-demo.tar.gz
tar xzf datashuttle-demo.tar.gz && cd datashuttle-demo
docker compose up -d
```

This starts the following services:

| Service | Port | Purpose |
|---------|------|---------|
| DataShuttle | [localhost:8080](http://localhost:8080) | Ingestion engine (API + Web UI) |
| Apache Polaris | `:8181` | Iceberg REST catalog |
| MinIO | [localhost:9001](http://localhost:9001) | S3-compatible object storage |
| PostgreSQL | `:5432` | Demo source database (`ecommerce`) |

Wait for everything to be healthy:

```bash
docker compose ps
```

All services should show `healthy` status. This usually takes 15–30 seconds.

The PostgreSQL database comes pre-loaded with sample e-commerce data:

| Table | Rows | Description |
|-------|------|-------------|
| `customers` | 500 | Customer profiles with addresses |
| `products` | 100 | Product catalog with pricing |
| `orders` | 2,000 | Order headers with totals |
| `order_items` | 5,000 | Line items per order |
| `payments` | 2,000 | Payment records per order |

## Step 2: Create a connection

Open the **Web UI** at [http://localhost:8080/ui/sql](http://localhost:8080/ui/sql) and enter:

```sql
CREATE CONNECTION demo_pg
  TYPE POSTGRES
  WITH (
    host = 'postgres',
    port = '5432',
    database = 'ecommerce',
    user = 'postgres',
    password = 'postgres',
    publication = 'datashuttle_pub'
  );
```

Or via the CLI:

```bash
docker exec datashuttle-datashuttle-1 datashuttle sql -e "
  CREATE CONNECTION demo_pg
    TYPE POSTGRES
    WITH (
      host = 'postgres',
      port = '5432',
      database = 'ecommerce',
      user = 'postgres',
      password = 'postgres',
      publication = 'datashuttle_pub'
    );
"
```

> **Note:** The hostname `postgres` matches the Docker Compose service name. The publication `datashuttle_pub` is created automatically by the init script.

## Step 3: Create a pipeline

Replicate the orders, customers, and products tables:

```sql
CREATE PIPELINE ecommerce_sync
  SOURCE demo_pg SCHEMA public TABLES (orders, customers, products)
  TARGET warehouse.raw
  SCHEDULE continuous
  WITH (
    commit_interval = '10 seconds',
    delete_mode = 'deletion_vectors'
  );
```

This single statement:
1. Loads all existing data from the `orders`, `customers`, and `products` tables
2. Starts continuous sync — changes in PostgreSQL appear in Iceberg within seconds
3. Writes Parquet data files to MinIO
4. Commits to the Iceberg catalog every 10 seconds

## Step 4: Verify data is flowing

Check the pipeline status in the SQL console:

```sql
SHOW PIPELINE STATUS ecommerce_cdc
```

Or via the CLI:

```bash
docker exec datashuttle-datashuttle-1 datashuttle pipeline status ecommerce_cdc
```

You should see the pipeline in `running` or `syncing` state. The initial load will process:
- 500 customer rows
- 100 product rows
- 2,000 order rows

Open the **Web UI** at [http://localhost:8080](http://localhost:8080) to see the pipeline dashboard with live metrics.

### Make a change and watch it replicate

Insert a new row in the source:

```bash
docker exec postgres psql -U postgres -d ecommerce -c \
  "INSERT INTO customers (first_name, last_name, email, segment) VALUES ('Eve', 'New', 'eve@example.com', 'premium');"
```

Within 10 seconds (the commit interval), the row count increases by 1.

## Step 5: Explore

```sql
-- List all pipelines
SHOW PIPELINES

-- Describe pipeline details
DESCRIBE PIPELINE ecommerce_cdc

-- List connections
SHOW CONNECTIONS

-- Describe connection
DESCRIBE CONNECTION demo_pg

-- Pause the pipeline
PAUSE PIPELINE ecommerce_cdc

-- Resume it
RESUME PIPELINE ecommerce_cdc
```

Or check Prometheus metrics:

```bash
curl -s http://localhost:9090/metrics | grep ecommerce_cdc
```

## Clean up

```bash
docker compose -f examples/docker-compose.yml down -v
```

## Next steps

- **Add more connectors** — [MySQL](./connectors/mysql.md), [MongoDB](./connectors/mongodb.md), [S3 files](./connectors/files.md)
- **Run the full demo** — the `datashuttle-demo.tar.gz` release asset covers PostgreSQL, MySQL, MongoDB, and file ingestion end-to-end
- **Deploy to production** — [Deployment guide](./operations/deployment.md)
- **Set up monitoring** — [Monitoring & alerting](./operations/monitoring.md)
- **Manage pipelines as code** — [GitOps](./operations/gitops.md)
- **Learn the SQL syntax** — [SQL Reference](./sql-reference/connections.md)
