# Architecture

DataShuttle uses a **shared-nothing architecture** where every node is equal and autonomous. There is no coordinator, no master, no single point of failure.

## System overview

```
┌──────────────────────────────────────────────────────────────────┐
│                      DataShuttle Node                            │
│                                                                  │
│  ┌────────────┐   ┌─────────────┐   ┌────────────────────────┐  │
│  │ SQL Parser  │──▶│  Pipeline   │──▶│   Source Connectors    │  │
│  │ (DDL)       │   │  Registry   │   │  23 connector types    │  │
│  └────────────┘   └─────────────┘   │  (see connector list)  │  │
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

DataShuttle ships as a workspace of ~13 Rust crates. Cloud-only concerns are isolated in their own crates so OSS builds stay lean and dep-free.

| Crate | Purpose |
|-------|---------|
| `datashuttle-traits` | Zero-dependency contract crate; trait definitions shared across the workspace |
| `datashuttle-core` | SQL parser, pipeline registry, transforms, config, schema evolution, RBAC, lineage, playground manifest types |
| `datashuttle-control` | Identity / org / membership / invitation / API-tokens / SSO domain + repositories (in-memory default; Postgres impl lives in cloud crate) |
| `datashuttle-license` | Tier + feature-gate + DPU metering |
| `datashuttle-iceberg` | Iceberg V3 writer, commit protocol, deletion vectors (Puffin), compaction, credential vending |
| `datashuttle-cdc` | `SourceConnector` trait + `CdcError` enum (419 LOC after Phase 7 cleanup, #839). Driver code lives in 22 sidecar crates (`datashuttle-connector-<X>`), one binary each, spawned out-of-process by the api over gRPC + Arrow Flight. |
| `datashuttle-orchestration` | Pipeline-level utilities — checkpoint manager, schema-evolution, dlq, snapshot lease, retry, parallel-read assignment, `ConnectorFactory` registry. Linked into the api; never compiled into sidecars. |
| `datashuttle-connector-protocol` | gRPC `ConnectorControl` service contract + ed25519 Flight-ticket helpers. Tonic-generated stubs ship here; both api and sidecars depend on this crate. |
| `datashuttle-connector-supervisor` | `ProcessManager`, manifest loader, ed25519 trust store, lazy-spawn (`ensure_worker_for`), idle reaper. Owned by the api; reads connector binaries from the manifest at boot, terminates them post-`Capabilities`, respawns on first pipeline that needs them. |
| `datashuttle-flight` | Arrow Flight hot buffer, flush worker, Raft replication, backpressure |
| `datashuttle-gossip` | Cluster membership via SWIM gossip, lease-based ownership, rebalancing |
| `datashuttle-api` | REST API, WebSocket, Prometheus `/metrics`, auth, pool scheduler, time-series metrics, cgroups. **Cloud-free dep graph** — no sqlx / aws-sdk / redis pulled in by default |
| `datashuttle-playground` | Interactive demo runtime — sessions, TCP dispatcher, per-user quota, prometheus bundle, `/playground/*` handlers |
| `datashuttle-cloud` | SaaS-only augmentations: Postgres control-plane repos, Redis kv, AWS tenant provisioning, admin-console handlers, enterprise SSO, cloud playground dispatcher |
| `datashuttle-client` | Thin HTTP-only client crate backing the `datashuttle` CLI binary (~12MB, zero server deps) |
| `datashuttle-ui` | Embedded React Web UI (rust-embed) + mdBook docs; served from any node, CDN-hostable as a separate tarball |
| `datashuttle-cli` | Binary crate(s): `datashuttle` thin client, `datashuttled` server daemon. Only crate that can pull all others together behind the `saas` feature |

### Extension hooks

Post-decomposition, the api crate doesn't carry cloud-specific or playground-specific code. Instead it exposes three **extension slots** on `AppState` that the cli wires at boot:

- `cloud_router_extender` — cloud mounts sibling routes (`/orgs/:id/sso/*`, billing, etc.) without touching the base router
- `admin_router_provider` — cloud provides admin-console routes (`/admin/users`, `/admin/orgs`, `/admin/tenants`) that merge into the base admin tree before middleware layers
- `playground_runtime` + `playground_router_extender` — the playground crate plugs its runtime + `/playground/*` mount

OSS builds leave these at safe defaults (Noop trait-objects / `None` fn-pointers); the cli's `saas` feature swaps in cloud impls. This pattern is what made #817 (cloud extraction) + #818 (playground extraction) + #830 (admin-router split) possible without forking api or sprinkling `#[cfg(feature = "saas")]` through the codebase.

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

## Source connector catalog

| Connector type | Change tracking | Incremental reads | Parallel (MPP) | Min latency |
|----------------|:---------------:|:-----------------:|:--------------:|-------------|
| `postgres` | ✅ WAL / pgoutput | ✅ | ✅ | Sub-second |
| `mysql` | ✅ binlog / GTID | ✅ | ✅ | Sub-second |
| `mongodb` | ✅ change streams | ✅ | ✅ | Sub-second |
| `oracle` | ✅ LogMiner | ✅ | ✅ | Sub-second |
| `cockroachdb` | ✅ changefeeds | ✅ | ✅ | Sub-second |
| `kinesis` | ✅ shard iterator | — | ✅ | Sub-second |
| `sqlserver` | ✅ CDC / CT tables | ✅ | ✅ | Seconds |
| `dynamodb` | ✅ DynamoDB Streams | ✅ | ✅ | Seconds |
| `cassandra` | ✅ CDC log | ✅ | ✅ | Seconds |
| `snowflake` | ✅ Streams + Tasks | ✅ | ✅ | Minutes |
| `databricks` | ✅ Delta CDF | ✅ | ✅ | Minutes |
| `bigquery` | — | ✅ watermark | ✅ | Minutes |
| `clickhouse` | — | ✅ watermark | ✅ MPP cluster | Minutes |
| `greenplum` | — | ✅ watermark | ✅ segments | Minutes |
| `vertica` | — | ✅ watermark | ✅ | Minutes |
| `starrocks` | — | ✅ watermark | ✅ | Minutes |
| `kafka` | ✅ consumer offsets | — | ✅ | Sub-second |
| `rest_api` | — | ✅ cursor/watermark | — | Minutes |
| `hadoop` | — | ✅ directory scan | — | Minutes |
| `s3` / cloud storage | — | ✅ file listing | — | Seconds–Minutes |
| `salesforce` | — | ✅ | — | Minutes |

## Key design decisions

| Decision | Rationale |
|----------|-----------|
| Shared-nothing (no coordinator) | Eliminates SPOF, simplifies operations |
| Iceberg catalog as single shared state | Leverages existing catalog infrastructure |
| Lease-based ownership | Prevents split-brain without distributed consensus |
| Crash-stop on invariant violation | Silent corruption is worse than downtime |
| TLA+-verified protocols | Critical paths proven correct before implementation |
