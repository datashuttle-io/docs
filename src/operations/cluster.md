# Cluster Management

DataShuttle nodes discover each other via SWIM gossip. No external service registry is needed.

## Cluster authentication (#968)

Cluster mode requires a pre-shared `cluster_token` on every node. Same
secret across the whole cluster. Two layers of defense:

1. **Membership-layer:** the chitchat `cluster_id` is derived from
   the token via HMAC-SHA256 — peers without the secret compute a
   different cluster_id and the membership protocol rejects them.
2. **Per-packet HMAC** (#968 Phase 2): every gossip datagram is
   wrapped in a `(MAGIC || ts_ms || payload || HMAC_SHA256)` frame
   keyed by the same token. Packets without a valid HMAC are dropped
   at the receiver before chitchat ever sees them. Stale packets
   (clock skew > 60 s) are dropped too — defends against replay
   attacks.

```bash
# Option 1 — env var
export DS_CLUSTER_TOKEN=$(openssl rand -hex 32)
datashuttle start --config datashuttle.yaml

# Option 2 — config file
[cluster]
gossip_addr = "0.0.0.0:7946"
cluster_token = "..."
```

Test harnesses can bypass with `DS_CLUSTER_TOKEN_OPTIONAL=1` (logs a
WARN, never set in production). The bypass falls back to the legacy
plain `UdpTransport` — no HMAC, no membership-layer derivation. Never
deploy that way.

Helm chart users: see `secrets.clusterToken` in `values.yaml`. The
chart wires it as `DS_CLUSTER_TOKEN` automatically when cluster mode
is enabled.

> Threat model: the token + per-packet HMAC together defend against
> rogue pods in the same k8s namespace / VPC AND against in-network
> attackers who can sniff and replay packets. For end-to-end transport
> confidentiality (encryption of metadata in transit), pair with
> NetworkPolicy / mTLS at the pod-network layer. Token rotation: roll
> out a new secret one node at a time during a maintenance window —
> mid-rotation the cluster temporarily has two membership groups.

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
