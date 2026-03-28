# DataShuttle

**Iceberg V3-native ingestion engine.** Declarative CDC from any source to Apache Iceberg with sub-minute latency.

DataShuttle replaces the Debezium → Kafka → Flink → Iceberg pipeline with a single SQL statement and a single binary.

```sql
CREATE PIPELINE orders_sync
  SOURCE crm_prod TABLE orders
  TARGET warehouse.raw
  WITH (
    mode = 'CDC',
    delete_mode = 'deletion_vectors',
    schema_evolution = 'compatible',
    commit_interval = '30 seconds'
  );
```

## Who is this for?

Data engineers and platform teams who need to get operational database changes into Apache Iceberg tables — without managing a multi-system streaming pipeline.

## What you'll find here

| Section | What's covered |
|---------|----------------|
| [Quickstart](./quickstart.md) | End-to-end in 5 minutes with Docker Compose |
| [Installation](./installation/docker.md) | Docker, binary, Homebrew, DEB/RPM, cargo, source |
| [Concepts](./concepts/architecture.md) | Architecture, pipeline lifecycle, safety guarantees |
| [Connectors](./connectors/postgresql.md) | PostgreSQL, MySQL, MongoDB, S3 — setup and type mappings |
| [SQL Reference](./sql-reference/connections.md) | Full DDL syntax for connections and pipelines |
| [Operations](./operations/deployment.md) | Deployment, monitoring, GitOps, clustering, troubleshooting |
| [API Reference](./api-reference/rest.md) | REST API, CLI commands, WebSocket events |

## Quick links

- [GitHub Repository](https://github.com/evgenyestepanov-star/datashuttle)
- [Full Specification](https://github.com/evgenyestepanov-star/datashuttle/blob/main/docs/SPEC.md)
- [Contributing Guide](https://github.com/evgenyestepanov-star/datashuttle/blob/main/docs/CONTRIBUTING.md)
