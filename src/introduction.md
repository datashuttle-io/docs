# DataShuttle

**One SQL statement. Any source. Apache Iceberg.**

If you've ever tried to keep an operational database in sync with a
lakehouse, you know the drill: Kafka, Debezium, a Flink job, a schema
registry, a custom shuttle that nobody wants to touch. Four systems
to operate, glue code in between, and a latency that's measured in
minutes when you wanted seconds.

DataShuttle collapses that entire stack into one binary and one SQL
statement. You point it at a source (Postgres, MySQL, MongoDB, Kafka,
S3 files, a REST API — 20+ connectors), you declare the target
Iceberg table, and it runs forever: snapshot first, then live change
capture, with deletion vectors, partition evolution, and schema
evolution built in.

```sql
CREATE SHUTTLE orders_sync
  SOURCE crm_prod TABLE orders
  TARGET warehouse.raw
  SCHEDULE continuous
  WITH (
    delete_mode = 'deletion_vectors',
    schema_evolution = 'compatible',
    commit_interval = '30 seconds'
  );
```

That's it. No Kafka. No Flink. No Spark. No orchestrator. Run that
statement against a DataShuttle instance and orders land in Iceberg
within seconds of being written to the source.

## Why it's different

| | DataShuttle | Debezium + Kafka + Flink | Airbyte | Fivetran |
|---|---|---|---|---|
| **Setup** | 1 SQL statement | 4 systems to configure | UI wizard | UI wizard |
| **Target** | Open Iceberg V3 | Iceberg via connector | Varies | Proprietary |
| **Latency (hot)** | <100 ms via Arrow Flight | Seconds | 5–60 min | 5–60 min |
| **Latency (cold → Iceberg)** | <30 s | Seconds | 5–60 min | 5–60 min |
| **Deletion vectors** | Native V3 | — | — | N/A |
| **Architecture** | Shared-nothing, one binary | 4+ JVMs | Docker / K8s | SaaS |
| **Deployment** | Cloud · self-hosted · airgapped | Self-hosted | Cloud + self-hosted | Cloud only |

## Try it in 2 minutes — no install needed

The fastest way to see DataShuttle work is the
**[interactive Playground](https://github.com/evgenyestepanov-star/datashuttle-playground/blob/main/docs/playground.md)**. Spin it up once with
Docker Compose and you get a guided sandbox with 18 pre-built
scenarios: a happy-path Postgres CDC run, schema evolution on a live
shuttle, Kafka poison messages + replay from the DLQ, MongoDB
nested-field evolution, ClickHouse time travel, even Tier-4 chaos
scenarios (network latency, slow consumers, 50 MB BLOBs). Click
**Start**, watch Iceberg fill up in real time, break the shuttle on
purpose, replay. No real data involved.

Once the playground feels familiar, the [Quickstart](./quickstart.md)
takes ~5 minutes to connect DataShuttle to a real Postgres and start
streaming your own data into Iceberg.

## What you'll find in these docs

**Getting started**

- [Quickstart](./quickstart.md) — end-to-end demo in 5 minutes
- [Playground](https://github.com/evgenyestepanov-star/datashuttle-playground/blob/main/docs/playground.md) — guided scenarios, no setup beyond Docker
- [Installation](./installation/docker.md) — Docker, Homebrew, DEB/RPM, binary

**Understanding the engine**

- [Architecture](./concepts/architecture.md) — shared-nothing, Arrow Flight hot path, Iceberg cold path
- [Shuttle Lifecycle](./concepts/shuttle-lifecycle.md) — state machine you'll see in the UI
- [Safety & Correctness](./concepts/safety.md) — exactly-once, replay, crash recovery
- [Configuration](./concepts/configuration.md) — `datashuttle.yaml` reference

**Connecting your data**

- [Connectors](./connectors/postgresql.md) — 20+ sources (PostgreSQL, MySQL, MongoDB, Kafka, S3, REST, and more)
- [Iceberg Catalogs](./connectors/iceberg-catalogs.md) — Polaris, Unity, Glue, REST catalogs

**Shipping it**

- [Deployment](./operations/deployment.md) — Docker, Helm, systemd, standalone binary
- [Monitoring](./operations/monitoring.md) — Prometheus, Grafana dashboards, alerting rules
- [Backup & Recovery](./operations/backup.md) — DR-ready backups, tested runbooks
- [Licensing](./operations/licensing.md) — tiers, DPU pricing, airgap workflow

**Building against it**

- [SQL Reference](./sql-reference/connections.md) — full DDL syntax
- [REST API](./api-reference/rest.md) · [CLI](./api-reference/cli.md) · [WebSocket](./api-reference/websocket.md)

## How to deploy it

DataShuttle runs the same binary in three modes:

| Mode | Who it's for | Setup |
|---|---|---|
| **DataShuttle Cloud** (private beta) | Teams that want zero-ops, managed Iceberg ingestion | Sign up at [app.datashuttle.ai](https://app.datashuttle.ai) |
| **Self-hosted** | VPC or on-prem with internet egress | `docker pull ghcr.io/datashuttle-ai/datashuttle:latest` |
| **Airgapped** | Regulated / disconnected networks | Binary download, local signed ledger, quarterly usage export |

Same licence, same features, same binary.
