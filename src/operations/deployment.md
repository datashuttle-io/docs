# Deployment

DataShuttle supports multiple deployment models — from a single Docker container to a multi-node Kubernetes cluster.

## Docker

```bash
docker run -d \
  --name datashuttle \
  -p 8080:8080 \
  -p 9090:9090 \
  -v /path/to/datashuttle.yaml:/etc/datashuttle/datashuttle.yaml:ro \
  ghcr.io/evgenyestepanov-star/datashuttle:latest
```

See [Docker installation](../installation/docker.md) for image details.

### Docker Compose (development)

```bash
docker compose -f docker/docker-compose.yaml up -d
```

Starts DataShuttle with MinIO, Apache Polaris, PostgreSQL, and MySQL.

## Systemd (DEB / RPM)

```bash
# Install
sudo dpkg -i datashuttle_*.deb       # Debian/Ubuntu
sudo rpm -i datashuttle-*.rpm         # RHEL/Fedora

# Configure
sudo vim /etc/datashuttle/datashuttle.yaml

# Start
sudo systemctl enable --now datashuttle

# Monitor
sudo systemctl status datashuttle
journalctl -u datashuttle -f
```

See [DEB / RPM installation](../installation/packages.md) for package contents.

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
---
apiVersion: v1
kind: Service
metadata:
  name: datashuttle
spec:
  clusterIP: None   # headless — required for gossip discovery
  selector:
    app: datashuttle
  ports:
    - port: 7946
      name: gossip
```

> **Helm chart:** A dedicated Helm chart is planned. For now, use raw manifests or Kustomize.

## Standalone binary

Download from [GitHub Releases](https://github.com/evgenyestepanov-star/datashuttle/releases) and run directly:

```bash
datashuttle start --config /etc/datashuttle/datashuttle.yaml
```

Useful for bare-metal servers, edge deployments, or testing. Combine with your own systemd unit or process supervisor.

## Port reference

| Port | Protocol | Purpose |
|------|----------|---------|
| 8080 | HTTP | REST API + embedded Web UI |
| 9090 | HTTP | Prometheus metrics |
| 7946 | TCP/UDP | Gossip protocol (cluster membership) |
