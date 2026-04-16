# Deployment

DataShuttle supports multiple deployment models — from a single Docker container to a multi-node Kubernetes cluster.

## Docker

```bash
docker run -d \
  --name datashuttle \
  -p 8080:8080 \
  -p 9090:9090 \
  -v /path/to/datashuttle.yaml:/etc/datashuttle/datashuttle.yaml:ro \
  ghcr.io/datashuttle/datashuttle:latest
```

See [Docker installation](../installation/docker.md) for image details.

### Docker Compose

```bash
docker compose up -d
```

The `docker-compose.yaml` at the project root starts DataShuttle with MinIO (object storage) and Apache Polaris (Iceberg catalog). Connect it to your existing source databases.

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

## Kubernetes (Helm)

The recommended way to deploy on Kubernetes is the official Helm chart:

```bash
# Single-node
helm install datashuttle deploy/helm/datashuttle

# 3-node cluster
helm install datashuttle deploy/helm/datashuttle \
  --set replicaCount=3

# With Prometheus monitoring
helm install datashuttle deploy/helm/datashuttle \
  --set replicaCount=3 \
  --set serviceMonitor.enabled=true \
  --set prometheusRule.enabled=true

# With HPA auto-scaling (requires prometheus-adapter)
helm install datashuttle deploy/helm/datashuttle \
  --set replicaCount=3 \
  --set autoscaling.enabled=true \
  --set autoscaling.customMetrics=true

# With resource pools
helm install datashuttle deploy/helm/datashuttle \
  --set replicaCount=3 \
  -f my-pool-values.yaml
```

The chart creates:

| Resource | Purpose |
|----------|---------|
| StatefulSet | DataShuttle nodes with stable identities |
| ConfigMap | `datashuttle.yaml` generated from values |
| Service (ClusterIP) | API + Web UI + Arrow Flight |
| Service (headless) | Gossip discovery between nodes |
| ServiceAccount | Pod identity |
| PVC | Checkpoint and local state persistence |
| Ingress (optional) | External access to Web UI/API |
| ServiceMonitor (optional) | Prometheus auto-discovery |
| PrometheusRule (optional) | Alerting rules for sync lag, errors, node health |
| HPA (optional) | Auto-scaling based on CPU + custom metrics |

### Secrets

Catalog and storage credentials are injected from Kubernetes Secrets:

```bash
# Create secrets
kubectl create secret generic catalog-creds \
  --from-literal=DS_CATALOG_CLIENT_ID=root \
  --from-literal=DS_CATALOG_CLIENT_SECRET=s3cr3t

kubectl create secret generic storage-creds \
  --from-literal=DS_S3_ACCESS_KEY=minioadmin \
  --from-literal=DS_S3_SECRET_KEY=minioadmin

# Reference in values
helm install datashuttle deploy/helm/datashuttle \
  --set catalogSecret=catalog-creds \
  --set storageSecret=storage-creds
```

### Resource pools in Kubernetes

```yaml
# pool-values.yaml
config:
  resourcePools:
    - name: critical
      mode: dedicated
      nodes: [datashuttle-0, datashuttle-1]
      priority: high
      limits:
        max_pipelines: 10
        max_concurrent_snapshots: 3
    - name: batch
      mode: elastic
      nodes: [datashuttle-2]
      priority: low
      limits:
        max_pipelines: 50
```

See `deploy/helm/datashuttle/values.yaml` for all configuration options.

## Kubernetes Operator (CRD-based)

For declarative pipeline management, use the DataShuttle Kubernetes Operator:

```yaml
# DataShuttleConnection
apiVersion: datashuttle.io/v1
kind: DataShuttleConnection
metadata:
  name: pg-prod
spec:
  connectionType: postgres
  properties:
    host: pg-primary.internal
    port: "5432"
    database: production
  secretRef: pg-prod-credentials

---
# DataShuttlePipeline
apiVersion: datashuttle.io/v1
kind: DataShuttlePipeline
metadata:
  name: orders-sync
spec:
  connection: pg-prod
  tables: [orders, customers, payments]
  target: warehouse.raw
  schedule: continuous
  resource_pool: critical
```

The operator reconciles CRD state with the DataShuttle REST API — creating, updating, and deleting pipelines and connections automatically.

CRDs available:
- **DataShuttlePipeline** — manages pipeline lifecycle
- **DataShuttleConnection** — manages source connections (with K8s Secret support)
- **DataShuttleCluster** — manages StatefulSet replicas and auto-scaling

Source: `deploy/operator/`

## Standalone binary

Download from [GitHub Releases](https://github.com/datashuttle/datashuttle/releases) and run directly:

```bash
datashuttle start --config /etc/datashuttle/datashuttle.yaml
```

## Port reference

| Port | Protocol | Purpose |
|------|----------|---------|
| 8080 | HTTP | REST API + embedded Web UI |
| 9090 | HTTP | Prometheus metrics |
| 8815 | gRPC | Arrow Flight (real-time queries) |
| 7946 | TCP/UDP | Gossip protocol (cluster membership) |
