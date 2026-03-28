# Cluster Management

DataShuttle nodes discover each other via SWIM gossip. No external service registry is needed.

## Adding nodes

Start a new node with `--seed-nodes` pointing to any existing node:

```bash
datashuttle start --config datashuttle.yaml --seed-nodes node1:7946,node2:7946
```

The new node joins the gossip ring automatically. Pipelines rebalance within 30 seconds.

## Removing nodes

Simply stop the node. Gossip detects the departure and reassigns its pipelines to surviving nodes.

```bash
# Graceful: drain first, then stop
datashuttle pipeline pause --owner node-3
systemctl stop datashuttle
```

## Rolling upgrades

1. **Drain** pipelines from the target node:

    ```bash
    datashuttle pipeline pause --owner node-3
    ```

2. **Upgrade** the binary (replace the file, update the Docker image, etc.)

3. **Restart** the node:

    ```bash
    datashuttle start --config datashuttle.yaml
    ```

4. Pipelines **automatically rebalance** back to the upgraded node.

Repeat for each node. The cluster remains available throughout the process.

## Cluster status

```bash
# CLI
datashuttle status

# REST API
curl http://localhost:8080/api/v1/cluster/status
curl http://localhost:8080/api/v1/cluster/nodes
```

## Networking

| Port | Protocol | Purpose |
|------|----------|---------|
| 7946 | TCP + UDP | Gossip protocol (SWIM) |
| 8080 | TCP | REST API + Web UI (any node) |
| 9090 | TCP | Prometheus metrics |

Gossip uses both TCP (reliable state sync) and UDP (protocol messages). Ensure both are open between nodes.
