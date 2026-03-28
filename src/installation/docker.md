# Docker

The official multi-arch Docker image is the fastest way to get started.

## Pull and run

```bash
docker pull ghcr.io/evgenyestepanov-star/datashuttle:latest
docker run -p 8080:8080 ghcr.io/evgenyestepanov-star/datashuttle:latest
```

## Image details

| Property | Value |
|----------|-------|
| Registry | `ghcr.io/evgenyestepanov-star/datashuttle` |
| Base | `debian:bookworm-slim` |
| Platforms | `linux/amd64`, `linux/arm64` |
| PID 1 | `tini` (proper signal handling) |
| User | Non-root `datashuttle` user |
| Ports | 8080 (API + UI), 9090 (metrics), 7946 (gossip) |

## Production usage

Mount your configuration file and expose ports:

```bash
docker run -d \
  --name datashuttle \
  -p 8080:8080 \
  -p 9090:9090 \
  -v /path/to/datashuttle.yaml:/etc/datashuttle/datashuttle.yaml:ro \
  ghcr.io/evgenyestepanov-star/datashuttle:latest
```

## Docker Compose (development)

For local development with supporting infrastructure (MinIO, Polaris, PostgreSQL, MySQL):

```bash
docker compose -f docker/docker-compose.yaml up -d
```

See the [Quickstart](../quickstart.md) for a full walkthrough.

## Verify

```bash
docker run --rm ghcr.io/evgenyestepanov-star/datashuttle:latest --version
```
