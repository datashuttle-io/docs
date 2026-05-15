# Quickstart

Get DataShuttle running and replicate your first Postgres table into
Iceberg in about five minutes.

> 💡 **Even faster: try the [Playground](./playground.md) first.**
> It's the same stack but with 18 pre-built scenarios (happy-path
> CDC, schema evolution, DLQ replay, ClickHouse time travel, network
> chaos, and more). No real data touched, no SQL to write — click
> Start and watch Iceberg fill up.

## Prerequisites

Just **Docker** (and Docker Compose v2). Everything else runs in
containers.

## Step 1 — Start the demo stack

The tagged release ships a `datashuttle-demo.tar.gz` bundle with a
Docker Compose file that starts DataShuttle alongside all the
supporting services it needs:

```bash
curl -LO https://github.com/datashuttle-io/datashuttle/releases/latest/download/datashuttle-demo.tar.gz
tar xzf datashuttle-demo.tar.gz && cd datashuttle-demo
docker compose up -d
```

Services that come up:

| Service | Where to reach it | Purpose |
|---|---|---|
| DataShuttle | <http://localhost:8080> | Ingestion engine (API + Web UI) |
| Apache Polaris | `localhost:8181` | Iceberg REST catalog |
| MinIO | <http://localhost:9001> | S3-compatible object storage |
| PostgreSQL | `localhost:5432` | Demo source database (`ecommerce`) |

Wait for the stack to be ready:

```bash
docker compose ps
```

All services should show `healthy` (usually 15–30 s).

The Postgres container comes pre-loaded with e-commerce data:

| Table | Rows | What's in it |
|---|---|---|
| `customers` | 500 | Profiles + addresses |
| `products` | 100 | Product catalog |
| `orders` | 2,000 | Order headers |
| `order_items` | 5,000 | Line items |
| `payments` | 2,000 | Payments |

## Step 2 — Create a connection

Open the Web UI at <http://localhost:8080> and use the **New Connection**
form (or the equivalent mini-DDL surface in the Shuttles page) to run:

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

Or from the CLI:

```bash
docker exec datashuttle-datashuttle-1 datashuttle sql -e "
  CREATE CONNECTION demo_pg TYPE POSTGRES
    WITH (host='postgres', port='5432', database='ecommerce',
          user='postgres', password='postgres',
          publication='datashuttle_pub');
"
```

> The hostname `postgres` matches the Compose service name. The
> publication `datashuttle_pub` is created by the init script on
> first boot.

## Step 3 — Create a shuttle

Replicate three tables in one statement:

```sql
CREATE SHUTTLE ecommerce_sync
  SOURCE demo_pg SCHEMA public TABLES (orders, customers, products)
  TARGET warehouse.raw
  SCHEDULE continuous
  WITH (
    commit_interval = '10 seconds',
    delete_mode = 'deletion_vectors'
  );
```

That one line does four things:

1. Takes an initial snapshot of all three tables.
2. Starts continuous replication — every insert/update/delete in
   Postgres lands in Iceberg within the commit interval.
3. Writes Parquet data files to MinIO.
4. Commits to the Iceberg catalog every 10 seconds.

## Step 4 — Watch it work

Check status in the SQL console:

```sql
SHOW SHUTTLE STATUS ecommerce_sync;
```

Or from the CLI:

```bash
docker exec datashuttle-datashuttle-1 datashuttle shuttle status ecommerce_sync
```

The shuttle should be `running` once the initial snapshot finishes
(2,600 rows total — a second or two).

The Web UI at <http://localhost:8080> has a live shuttle dashboard
with rows/sec, commit cadence, and per-table progress.

### Replicate a change

Insert a new customer in the source:

```bash
docker exec postgres psql -U postgres -d ecommerce -c \
  "INSERT INTO customers (first_name, last_name, email, segment)
   VALUES ('Eve', 'New', 'eve@example.com', 'premium');"
```

Within 10 seconds (the commit interval) the new row is in Iceberg.
Deletes and updates propagate the same way — deletes use Iceberg V3
deletion vectors, so the target table is position-accurate without
full rewrites.

## Step 5 — Explore

```sql
-- List everything
SHOW SHUTTLES;
SHOW CONNECTIONS;

-- Inspect
DESCRIBE SHUTTLE ecommerce_sync;
DESCRIBE CONNECTION demo_pg;

-- Pause + resume
PAUSE SHUTTLE ecommerce_sync;
RESUME SHUTTLE ecommerce_sync;
```

Prometheus metrics at <http://localhost:9090/metrics> include per-shuttle
counters (bytes, rows, commits, DLQ events) and the Arrow Flight
hot-buffer latency histogram.

## Clean up

```bash
docker compose down -v
```

## Where to go next

- **[Playground](./playground.md)** — 18 guided scenarios: schema
  evolution, DLQ replay, Kafka throughput, MongoDB nested fields,
  network chaos. Same stack, zero setup beyond Docker.
- **Connect your own sources** — [PostgreSQL](./connectors/postgresql.md),
  [MySQL](./connectors/mysql.md), [MongoDB](./connectors/mongodb.md),
  [Kafka](./connectors/files.md), [S3 files](./connectors/files.md),
  [REST APIs](./connectors/rest-api.md), and 15+ more.
- **Deploy it properly** — [Deployment guide](./operations/deployment.md)
  covers Docker, Helm, systemd, and clustered setups.
- **Monitor it** — [Monitoring & alerting](./operations/monitoring.md)
  walks through Prometheus rules and the Grafana dashboard the Helm
  chart ships.
- **Manage shuttles as code** — [GitOps](./operations/gitops.md)
  (`datashuttle apply / diff / validate`).
- **Learn the full syntax** — [SQL Reference](./sql-reference/connections.md).

If you get stuck, <hello@datashuttle.ai> goes to a real person.
