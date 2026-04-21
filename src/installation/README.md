# Installation

DataShuttle ships as a single self-contained binary plus an optional
web UI, and can be run in four different deployment modes. Pick the
one that matches where you plan to operate it.

## Decision tree

```
Are you running in Kubernetes?
├─ Yes → Helm chart (see "Kubernetes" below)
└─ No
   Do you have internet access during install?
   ├─ Yes
   │  Do you want the service managed by the OS?
   │  ├─ Yes → systemd unit (see "Binary + systemd")
   │  └─ No  → Docker Compose (see "Docker")
   └─ No    → Air-gapped tarball (see "Air-gapped")
```

## Deployment modes

| Mode | Best for | Persistence | Managed by |
|------|----------|-------------|------------|
| **Binary + systemd** | On-prem VMs, bare-metal | `/var/lib/datashuttle` | `systemd` |
| **Docker Compose** | Quick evaluation, developer boxes | `datashuttle-data` named volume | Docker |
| **Kubernetes (Helm)** | Production clusters | PVC | Kubernetes |
| **Air-gapped tarball** | Restricted networks | operator-chosen path | operator |

Each mode has its own page with step-by-step install, upgrade, and
uninstall instructions:

- [Docker](./docker.md)
- [Binary Download](./binary.md)
- [Air-gapped install](./air-gapped.md)
- [Homebrew](./homebrew.md) *(macOS convenience)*
- [DEB / RPM Packages](./packages.md)

## Minimum requirements

- **Linux / macOS** (x86_64 or ARM64). Windows is not supported.
- **2 GB RAM** for the server process itself. Source-database snapshots
  spike higher — budget accordingly.
- **S3-compatible object store** (AWS S3, GCS, MinIO). Included in the
  docker-compose bundle; separate for binary/k8s installs.
- **Iceberg REST catalog** (Apache Polaris, Unity, Nessie, …). Included
  in the docker-compose bundle.
- **Persistent data directory** with ≥10 GB free. DataShuttle refuses
  to start if `DS_DATA_DIR` points to a `tmpfs` path (`/tmp/*`) — see
  [Operations → Persistence](../operations/persistence.md) for why.

## After install

Every mode ends with the same bootstrap:

1. `datashuttle setup --quickstart` — mints the first admin, writes a
   signed config, seeds the registry.
2. Point your browser at `http://<host>:8080` — the onboarding wizard
   takes over from there.
3. Run `datashuttle doctor` to verify the install (config + data
   directory + crypto key + registry).

See the [Quickstart](../quickstart.md) for a full walkthrough.
