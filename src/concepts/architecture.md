# Architecture

DataShuttle uses a **shared-nothing architecture** where every node is equal and autonomous. There is no coordinator, no master, no single point of failure.

## System overview

```
┌──────────────────────────────────────────────────────────────────┐
│                      DataShuttle Node                            │
│                                                                  │
│  ┌────────────┐   ┌─────────────┐   ┌────────────────────────┐  │
│  │ SQL Parser  │──▶│  Pipeline   │──▶│   Source Connectors    │  │
│  │ (DDL)       │   │  Registry   │   │  Postgres · MySQL      │  │
│  └────────────┘   └─────────────┘   │  MongoDB · S3/Files    │  │
│                                      └───────────┬────────────┘  │
│                                                  │               │
│  ┌────────────┐   ┌─────────────┐   ┌───────────▼────────────┐  │
│  │ REST API   │   │  Arrow      │◀──│  Transform Pipeline    │  │
│  │ + Web UI   │   │  Flight     │   │  (schema map, cast,    │  │
│  │ + Metrics  │   │  Server     │   │   metadata injection)  │  │
│  └────────────┘   └─────────────┘   └───────────┬────────────┘  │
│                                                  │               │
│  ┌────────────┐   ┌─────────────┐   ┌───────────▼────────────┐  │
│  │ Gossip     │   │  Hot Buffer │──▶│  Iceberg V3 Writer     │  │
│  │ (cluster)  │   │  (in-mem)   │   │  Parquet + Puffin DVs  │  │
│  └────────────┘   └─────────────┘   └───────────┬────────────┘  │
│                                                  │               │
└──────────────────────────────────────────────────┼───────────────┘
                                                   ▼
                                        ┌──────────────────┐
                                        │  Iceberg Catalog  │
                                        │  + Object Storage │
                                        └──────────────────┘
```

## Crate map

| Crate | Purpose |
|-------|---------|
| `datashuttle-core` | SQL parser, pipeline registry, transforms, config, error types |
| `datashuttle-iceberg` | Iceberg V3 writer, commit protocol, deletion vectors, compaction |
| `datashuttle-cdc` | Source connectors: PostgreSQL, MySQL, MongoDB, S3/file sources |
| `datashuttle-flight` | Arrow Flight hot buffer, flush worker, Raft replication |
| `datashuttle-gossip` | Cluster membership via SWIM gossip (chitchat) |
| `datashuttle-api` | REST API, WebSocket, Prometheus `/metrics`, auth middleware |
| `datashuttle-cli` | CLI binary: pipeline/connection management, SQL console, GitOps |
| `datashuttle-ui` | Embedded React Web UI (rust-embed, served from any node) |

## Coordination model

Nodes coordinate through the **Iceberg catalog** — the only shared state:

- **Pipeline definitions** are stored as Iceberg table properties
- **Ownership** uses lease-based assignment with monotonic fencing tokens
- **Commits** use optimistic concurrency with automatic retry
- **Cluster membership** is discovered via SWIM gossip (no external service registry)

This means you can lose any node and the cluster self-heals. There is no "brain" to protect.

## Data flow

1. **SQL Parser** receives `CREATE PIPELINE` and validates syntax
2. **Pipeline Registry** stores the definition and assigns ownership
3. **Source Connector** reads changes from the source database or storage system
4. **Transform Pipeline** maps source schema to Arrow, applies casts and metadata injection
5. **Hot Buffer** (optional) holds recent rows in-memory for Arrow Flight queries (<100ms latency)
6. **Iceberg Writer** batches Arrow RecordBatches into Parquet data files + Puffin deletion vector files
7. **Commit Protocol** atomically commits to the Iceberg catalog with checkpoint update

## Key design decisions

| Decision | Rationale |
|----------|-----------|
| Shared-nothing (no coordinator) | Eliminates SPOF, simplifies operations |
| Iceberg catalog as single shared state | Leverages existing catalog infrastructure |
| Lease-based ownership | Prevents split-brain without distributed consensus |
| Crash-stop on invariant violation | Silent corruption is worse than downtime |
| TLA+-verified protocols | Critical paths proven correct before implementation |
