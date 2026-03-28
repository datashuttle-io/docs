# Deployment

DataShuttle supports multiple deployment models — from a single Docker container to a multi-node Kubernetes cluster.

## Docker

The official Docker image is published to `ghcr.io` on every tagged release:

```bash
docker pull ghcr.io/evgenyestepanov-star/datashuttle:latest

docker run -d \
  --name datashuttle \
  -p 8080:8080 \
  -p 9090:9090 \
  -v /path/to/datashuttle.yaml:/etc/datashuttle/datashuttle.yaml:ro \
  ghcr.io/evgenyestepanov-star/datashuttle:latest
```

Image details:
- **Base:** `debian:bookworm-slim`
- **Platforms:** `linux/amd64`, `linux/arm64`
- **PID 1:** `tini` (proper signal handling)
- **User:** runs as non-root `datashuttle` user
- **Ports:** 8080 (API + UI), 9090 (metrics), 7946 (gossip)

### Docker Compose (development)

For local development with supporting infrastructure:

```bash
docker compose -f docker/docker-compose.yaml up -d
```

Starts MinIO, Apache Polaris, PostgreSQL, and MySQL.

## Systemd (DEB / RPM)

The DEB package includes a systemd unit file:

```bash
# Install
sudo dpkg -i datashuttle_*.deb    # Debian/Ubuntu
sudo rpm -i datashuttle-*.rpm      # RHEL/Fedora

# Configure
sudo vim /etc/datashuttle/datashuttle.yaml

# Start
sudo systemctl enable --now datashuttle

# Monitor
sudo systemctl status datashuttle
journalctl -u datashuttle -f
```

## Kubernetes

Deploy as a StatefulSet with a headless service for gossip discovery:

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: datashuttle
spec:
  serviceName: datashuttle
  replicas: 3
  selector:
    matchLabels:
      app: datashuttle
  template:
    metadata:
      labels:
        app: datashuttle
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
    spec:
      containers:
        - name: datashuttle
          image: ghcr.io/evgenyestepanov-star/datashuttle:latest
          ports:
            - containerPort: 8080
              name: api
            - containerPort: 9090
              name: metrics
            - containerPort: 7946
              name: gossip
          args:
            - start
            - --cluster-seeds
            - datashuttle-0.datashuttle:7946,datashuttle-1.datashuttle:7946
```

> **Helm chart:** A dedicated Helm chart is planned. For now, use raw manifests or Kustomize.

## Standalone binary

Download from [GitHub Releases](https://github.com/evgenyestepanov-star/datashuttle/releases) and run directly:

```bash
datashuttle start --config /etc/datashuttle/datashuttle.yaml
```

Useful for bare-metal servers, edge deployments, or testing. Combine with your own systemd unit or process supervisor.
