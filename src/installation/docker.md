# Docker

The official multi-arch Docker image is the fastest way to run DataShuttle.

## Pull and run

```bash
docker pull ghcr.io/datashuttle/datashuttle:latest
docker run -p 8080:8080 ghcr.io/datashuttle/datashuttle:latest
```

## Image details

| Property | Value |
|----------|-------|
| Registry | `ghcr.io/datashuttle/datashuttle` |
| Base | `debian:bookworm-slim` |
| Platforms | `linux/amd64`, `linux/arm64` |
| PID 1 | `tini` (proper signal handling) |
| User | Non-root `datashuttle` user |
| Ports | 8080 (API + UI), 9090 (metrics), 7946 (gossip) |

## Docker Compose

A minimal-infrastructure bundle (DataShuttle + MinIO object storage +
Apache Polaris catalog) ships with every release as a compose tarball:

```bash
curl -LO https://github.com/datashuttle/datashuttle/releases/latest/download/datashuttle-demo.tar.gz
tar xzf datashuttle-demo.tar.gz && cd datashuttle-demo
docker compose up -d
```

| Service | Port | Purpose |
|---------|------|---------|
| DataShuttle | `:8080` | Ingestion engine (API + Web UI) |
| Apache Polaris | `:8181` | Iceberg REST catalog |
| MinIO | `:9000` / `:9001` | S3-compatible object storage |

After starting, open [http://localhost:8080](http://localhost:8080) to access the Web UI.

> Source databases are **not included** — connect DataShuttle to your existing PostgreSQL, MySQL, or MongoDB. See the [Quickstart](../quickstart.md) for a step-by-step walkthrough.

## Running with your own config

Mount a configuration file and expose the ports you need:

```bash
docker run -d \
  --name datashuttle \
  -p 8080:8080 \
  -p 9090:9090 \
  -v /path/to/datashuttle.yaml:/etc/datashuttle/datashuttle.yaml:ro \
  ghcr.io/datashuttle/datashuttle:latest
```

Or use environment variables instead of a config file:

```bash
docker run -d \
  --name datashuttle \
  -p 8080:8080 \
  -p 9090:9090 \
  -e DS_CATALOG_TYPE=rest \
  -e DS_CATALOG_URI=http://polaris:8181/api/catalog \
  -e DS_WAREHOUSE=s3://warehouse/ \
  -e DS_S3_ENDPOINT=http://minio:9000 \
  -e DS_S3_ACCESS_KEY=minioadmin \
  -e DS_S3_SECRET_KEY=minioadmin \
  ghcr.io/datashuttle/datashuttle:latest
```

See [Configuration](../concepts/configuration.md) for all available options.

## Verify

```bash
# Check version
docker run --rm ghcr.io/datashuttle/datashuttle:latest --version

# Health check
curl http://localhost:8080/health
```
