# Air-gapped Install

For environments without internet access (regulated clouds, disconnected
data centres, CI-only VPCs), DataShuttle ships a **release tarball** that
bundles every artefact you need to run the server without reaching any
external registry.

## Tarball contents

```
datashuttle-v<version>-linux-amd64-airgapped.tar.gz
├── datashuttle                        # statically-linked server binary
├── datashuttle-ui.tar.gz              # pre-built web UI assets
├── docker-images/
│   ├── datashuttle-<version>.tar.gz   # docker image for offline load
│   ├── polaris-admin-tool.tar.gz
│   ├── minio.tar.gz
│   └── apache-polaris.tar.gz
├── packaging/
│   ├── systemd/datashuttle.service
│   └── docker-compose.airgapped.yaml
└── docs/book.tar.gz                   # offline copy of this documentation
```

Download from your release mirror (internal registry or USB-shipped
build) and extract on the target host:

```bash
tar xzf datashuttle-v1.0.0-linux-amd64-airgapped.tar.gz
cd datashuttle-v1.0.0-linux-amd64-airgapped
```

## Option 1 — Docker Compose, offline

Load the bundled images into the local Docker daemon, then start the
stack:

```bash
for img in docker-images/*.tar.gz; do
  gunzip -c "$img" | docker load
done

cp packaging/docker-compose.airgapped.yaml docker-compose.yaml
cp .env.example .env
# edit .env: set MINIO_ROOT_PASSWORD, POLARIS_CLIENT_SECRET,
#            POLARIS_PG_PASSWORD to unique values.

docker compose up -d
```

The air-gapped compose file is identical to the standard one except
that every image reference is a local tag (no `ghcr.io/` prefix), so
Docker never tries to pull.

## Option 2 — Binary + systemd, offline

```bash
sudo install -m 0755 datashuttle /usr/local/bin/datashuttle
sudo useradd --system --home /var/lib/datashuttle --shell /usr/sbin/nologin datashuttle || true
sudo mkdir -p /var/lib/datashuttle /etc/datashuttle
sudo chown datashuttle:datashuttle /var/lib/datashuttle /etc/datashuttle

# Pre-built UI assets (served statically by the server binary).
sudo tar xzf datashuttle-ui.tar.gz -C /usr/local/share/datashuttle/ui

sudo cp packaging/systemd/datashuttle.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now datashuttle
```

You must still supply:

- Your own S3-compatible object store (air-gapped MinIO is included
  in Option 1; for Option 2 point `config.s3.*` at your in-cluster
  MinIO / NetApp StorageGRID / MinIO).
- Your own Iceberg REST catalog reachable over the air-gapped network.

## Upgrade path

Drop the new tarball on the same host and repeat the load step.
`datashuttle migrate --apply` runs the embedded schema migrations
idempotently, so upgrades don't need internet access.

## Verification

After install:

```bash
/usr/local/bin/datashuttle doctor --config /etc/datashuttle/datashuttle.yaml
```

The doctor runs entirely offline — it checks config syntax, data-dir
writability, crypto-key mode, registry presence and config/env drift
without making network calls.

See also: [Operations → Persistence](../operations/persistence.md),
[Upgrading](../operations/upgrades.md).
