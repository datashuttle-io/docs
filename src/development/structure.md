# Project Structure

```
datashuttle/
├── crates/
│   ├── datashuttle-core/      # SQL parser, registry, transforms
│   ├── datashuttle-iceberg/   # Iceberg V3 writer, commit, DVs
│   ├── datashuttle-cdc/       # CDC connectors
│   ├── datashuttle-flight/    # Arrow Flight hot buffer
│   ├── datashuttle-gossip/    # Cluster gossip
│   ├── datashuttle-api/       # REST API + WebSocket
│   ├── datashuttle-cli/       # CLI binary
│   └── datashuttle-ui/        # Embedded Web UI
├── ui/                        # React source
├── docs/                      # Documentation
│   ├── SPEC.md               # Full specification
│   ├── SAFETY.md             # Correctness guarantees
│   └── book/                 # mdBook site
└── docker/                   # Docker Compose dev env
```
