# Quickstart

Get DataShuttle running and replicate your first table in 5 minutes.

## Prerequisites

- **Docker** and **Docker Compose** (v2)

That's it. Everything runs in containers.

## Step 1: Start the stack

Clone the repository and start DataShuttle with its infrastructure:

```bash
git clone https://github.com/evgenyestepanov-star/datashuttle.git
cd datashuttle
docker compose up -d
```

This starts three services:

| Service | Port | Purpose |
|---------|------|---------|
| DataShuttle | [localhost:8080](http://localhost:8080) | Ingestion engine (API + Web UI) |
| Apache Polaris | `:8181` | Iceberg REST catalog |
| MinIO | [localhost:9001](http://localhost:9001) | S3-compatible object storage |

Wait for everything to be healthy:

```bash
docker compose ps
```

All services should show `healthy` status. This usually takes 15–30 seconds.

> **No source databases are included.** This stack is just DataShuttle + catalog + storage. You connect it to your own PostgreSQL, MySQL, or MongoDB. For a full demo with sample source databases, see [examples/](https://github.com/evgenyestepanov-star/datashuttle/tree/main/examples).

## Step 2: Start a source database

For this quickstart, we'll run a PostgreSQL instance with sample data. In a separate terminal:

```bash
docker run -d \
  --name quickstart-postgres \
  --network datashuttle_default \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=demo \
  -p 5432:5432 \
  postgres:16 \
  -c wal_level=logical \
  -c max_replication_slots=10 \
  -c max_wal_senders=10
```

Wait for PostgreSQL to be ready, then create a sample table:

```bash
docker exec -i quickstart-postgres psql -U postgres -d demo <<'SQL'
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    customer TEXT NOT NULL,
    product TEXT NOT NULL,
    quantity INT NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO orders (customer, product, quantity, price) VALUES
    ('Alice', 'Widget A', 5, 29.99),
    ('Bob', 'Widget B', 2, 49.99),
    ('Charlie', 'Widget A', 10, 29.99),
    ('Alice', 'Widget C', 1, 99.99),
    ('Diana', 'Widget B', 3, 49.99);

CREATE PUBLICATION datashuttle_pub FOR TABLE orders;
SQL
```

## Step 3: Create a connection

Tell DataShuttle how to reach your PostgreSQL:

```bash
docker exec datashuttle-datashuttle-1 datashuttle sql -e "
  CREATE CONNECTION demo_pg
    TYPE POSTGRES
    PROPERTIES (
      host = 'quickstart-postgres',
      port = '5432',
      database = 'demo',
      username = 'postgres',
      password = 'postgres',
      publication = 'datashuttle_pub'
    );
"
```

## Step 4: Create a CDC pipeline

```bash
docker exec datashuttle-datashuttle-1 datashuttle sql -e "
  CREATE PIPELINE orders_cdc
    SOURCE demo_pg TABLE orders
    TARGET warehouse.raw
    WITH (
      mode = 'CDC',
      commit_interval = '10 seconds',
      delete_mode = 'deletion_vectors',
      schema_evolution = 'compatible'
    );
"
```

This single statement:
1. Takes an initial snapshot of the `orders` table
2. Starts streaming CDC changes from the PostgreSQL WAL
3. Writes Parquet data files to MinIO
4. Commits to the Iceberg catalog every 10 seconds

## Step 5: Verify data is flowing

Check the pipeline status:

```bash
docker exec datashuttle-datashuttle-1 datashuttle pipeline status orders_cdc
```

You should see the pipeline in `running` state with 5 rows ingested.

Open the **Web UI** at [http://localhost:8080](http://localhost:8080) to see the pipeline dashboard.

### Make a change and watch it replicate

Insert a new row in the source:

```bash
docker exec -i quickstart-postgres psql -U postgres -d demo -c \
  "INSERT INTO orders (customer, product, quantity, price) VALUES ('Eve', 'Widget D', 7, 19.99);"
```

Within 10 seconds (the commit interval), check the pipeline again — the row count increases by 1.

## Step 6: Explore

```bash
# List all pipelines
docker exec datashuttle-datashuttle-1 datashuttle pipeline list

# Pause the pipeline
docker exec datashuttle-datashuttle-1 datashuttle sql -e "PAUSE PIPELINE orders_cdc"

# Resume it
docker exec datashuttle-datashuttle-1 datashuttle sql -e "RESUME PIPELINE orders_cdc"

# View Prometheus metrics
curl -s http://localhost:9090/metrics | grep orders_cdc
```

## Clean up

```bash
docker rm -f quickstart-postgres
docker compose down -v
```

## Next steps

- **Add more connectors** — [MySQL](./connectors/mysql.md), [MongoDB](./connectors/mongodb.md), [S3 files](./connectors/files.md)
- **Run the full demo** — [examples/](https://github.com/evgenyestepanov-star/datashuttle/tree/main/examples) with PostgreSQL, MySQL, MongoDB, and file ingestion
- **Deploy to production** — [Deployment guide](./operations/deployment.md)
- **Set up monitoring** — [Monitoring & alerting](./operations/monitoring.md)
- **Manage pipelines as code** — [GitOps](./operations/gitops.md)
- **Learn the SQL syntax** — [SQL Reference](./sql-reference/connections.md)
