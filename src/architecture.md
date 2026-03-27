# Architecture

DataShuttle uses a **shared-nothing architecture** where every node is equal and autonomous. There is no coordinator, no master, no single point of failure.

## Crate Structure

```
datashuttle-cli ─► datashuttle-api ─► datashuttle-core
                                           │
                    datashuttle-flight ─────┘
                    datashuttle-cdc ────────┘
                    datashuttle-iceberg ────┘
                    datashuttle-gossip ─────┘
```

| Crate | Purpose |
|-------|---------|
| `datashuttle-core` | SQL parser, pipeline registry, transforms, config |
| `datashuttle-iceberg` | Iceberg V3 writer, commit protocol, deletion vectors |
| `datashuttle-cdc` | CDC connectors: PostgreSQL, MySQL, MongoDB, S3 |
| `datashuttle-flight` | Arrow Flight hot buffer, flush worker, Raft replication |
| `datashuttle-gossip` | Cluster membership via SWIM gossip |
| `datashuttle-api` | REST API, WebSocket, metrics, auth |
| `datashuttle-cli` | CLI binary |
| `datashuttle-ui` | Embedded React Web UI |

## Coordination

Nodes coordinate via the **Iceberg catalog** (the only shared state):
- Pipeline definitions stored in catalog
- Lease-based ownership with fencing tokens
- Optimistic concurrency for commits

See the full architecture in [SPEC.md §4](https://github.com/evgenyestepanov-star/datashuttle/blob/main/docs/SPEC.md#4-architecture).
