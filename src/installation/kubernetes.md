# Kubernetes (Helm)

The DataShuttle Helm chart lives at `deploy/helm/datashuttle` in the
repo and ships as an OCI artifact at
`oci://ghcr.io/datashuttle-ai/charts/datashuttle` on every release.

The chart deploys:

- A **StatefulSet** with stable per-pod identities for gossip peer
  discovery.
- A **headless Service** that the gossip layer uses for seed resolution.
- **Per-pod PersistentVolumeClaims** at `/data` (DataShuttle refuses
  to boot on a `tmpfs` path — see [Persistence](../operations/persistence.md)).
- Optional **PodDisruptionBudget**, **HorizontalPodAutoscaler**,
  **ServiceMonitor**, and **PrometheusRule** with the shipped alert
  rules.

The chart **does not** provision Apache Polaris or an S3 object
store — point it at existing instances. For cluster-local evaluation,
install Polaris and MinIO via their own charts first.

## Minimal install

```bash
helm install datashuttle oci://ghcr.io/datashuttle-ai/charts/datashuttle \
  --namespace datashuttle --create-namespace \
  --set replicaCount=3 \
  --set persistence.size=50Gi \
  --set config.catalog.uri=http://polaris.default.svc:8181/api/catalog \
  --set config.storage.warehouse=s3://warehouse/ \
  --set config.storage.endpoint=http://minio.default.svc:9000 \
  --set-string secrets.s3AccessKey=minioadmin \
  --set-string secrets.s3SecretKey=minioadmin
```

For production, supply `values-prod.yaml` rather than long `--set`
chains. See `values.yaml` for the full schema; the commonly tuned
keys are:

| Key | Purpose |
|-----|---------|
| `replicaCount` | Gossip cluster size. 3 is the smallest safe quorum; 5 for stretch clusters. |
| `persistence.size` | Per-pod PVC capacity (`registry.db` + `crypto/` + `checkpoints/` + `audit.jsonl`). |
| `persistence.storageClassName` | Pin to a RWO class that survives node failure. |
| `resources` | Start at 2 CPU / 4 GB, bump for high-throughput sources. |
| `autoscaling.enabled` | HPA on ingest throughput. Off by default. |
| `config.cluster.enabled` | Toggle gossip clustering (rarely turned off). |
| `ingress.enabled` | Expose the UI + API via an Ingress. |
| `serviceMonitor.enabled` | Create a Prometheus-operator ServiceMonitor. |
| `prometheusRule.enabled` | Ship the bundled alert rules. |

## Bootstrap

Installing the chart starts the server but does **not** provision the
first admin — that's a deliberate one-time ceremony so an operator
can choose the initial admin email and password. Pick any pod and
run:

```bash
kubectl exec -it datashuttle-0 -n datashuttle -- \
  datashuttle setup --quickstart --config /etc/datashuttle/datashuttle.yaml
```

Then open the web UI on the Ingress (or `kubectl port-forward
svc/datashuttle 8080:8080`).

## Verify

The `datashuttle doctor` diagnostic CLI runs eight offline checks
against whichever pod you exec into:

```bash
kubectl exec datashuttle-0 -n datashuttle -- datashuttle doctor
```

Expect `PASS` on all eight. The `data-dir-persistence` check is
particularly load-bearing — it confirms `DS_DATA_DIR=/data` is a
non-tmpfs, writable PVC path.

## Upgrade

```bash
helm upgrade datashuttle oci://ghcr.io/datashuttle-ai/charts/datashuttle \
  --namespace datashuttle \
  --set image.tag=v0.2.0
```

The chart performs a rolling update one pod at a time. The prestop
hook triggers a graceful drain, so no checkpoint data is lost.
Schema migrations run as a `Job` (`templates/migrations-job.yaml`)
before the StatefulSet rolls.

## Day-2 operations

### Crypto key rotation (#810)

The Ed25519 audit signing key lives on the shared PVC (one per pod,
so each pod holds its own key material). Rotate and kill every
active JWT in one step:

```bash
kubectl exec datashuttle-0 -n datashuttle -- \
  datashuttle crypto rotate-key --revoke-sessions true
```

Because the `sessions_invalidated_at` marker is persisted on each
pod's PVC, pods other than the one you exec'd into observe the
revocation within 30 seconds (the validator's mtime poll cadence).

### Backup (#808)

```bash
kubectl exec datashuttle-0 -n datashuttle -- \
  datashuttle backup create --output /data/backups/ --config /etc/datashuttle/datashuttle.yaml
```

The archive includes `crypto/` so a restored deployment passes the
fingerprint-drift check on boot. For a scheduled backup, run the
command from a Kubernetes `CronJob` with a sidecar that rsyncs the
resulting archive off-cluster.

### Uninstall

```bash
helm uninstall datashuttle --namespace datashuttle
kubectl delete pvc -n datashuttle -l app.kubernetes.io/name=datashuttle
kubectl delete namespace datashuttle
```

PVCs survive `helm uninstall` by design — delete them explicitly
only after confirming your backup is intact.

## See also

- [Helm chart README](../../../deploy/helm/datashuttle/README.md)
- [Persistence](../operations/persistence.md)
- [Upgrading DataShuttle](../operations/upgrades.md)
- [Backup & Restore](../operations/backup-restore.md)
