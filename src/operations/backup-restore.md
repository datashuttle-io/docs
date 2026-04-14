# Backup & Restore

DataShuttle ships a first-class backup / restore CLI (Phase 6 task 6.6,
tracked in [#564]). Archives are portable `tar.zst` files with an
Ed25519-signed `manifest.json` and per-entry SHA-256 hashes. The
signing key is the **same** key that anchors the Phase 5.5 audit chain,
so backup signatures and audit-log signatures share a single trust
anchor.

> **TL;DR** — run `datashuttle backup create --output ./backups/` from
> a cron job, stage the `.tar.zst` somewhere off-host, and restore with
> `datashuttle backup restore --from … --to /var/lib/datashuttle`.

[#564]: https://github.com/evgenyestepanov-star/datashuttle/issues/564

---

## Archive layout

```
backup-20260414T120000Z.tar.zst
├── manifest.json               # metadata + per-entry SHA-256 + signing key id
├── manifest.json.sig           # detached Ed25519 signature of manifest.json
├── registry.json               # portable registry export (pipelines, connections, history)
├── checkpoints/                # one file per pipeline checkpoint
│   ├── orders.checkpoint
│   └── …
├── audit/
│   ├── audit.jsonl.zst         # compressed tamper-evident audit log
│   └── audit-signatures.json   # fingerprint anchor (verifies before decompression)
└── config.redacted.yaml        # datashuttle.yaml with secrets replaced with `<redacted>`
```

`manifest.json` includes:
- `datashuttle_version`
- `created_at` (UTC RFC3339)
- `node_id`, `deployment_id`
- `registry_backend` (`sqlite` or `postgres`)
- `entries[]` — `{path, size_bytes, sha256}` for every other archive file
- `signing_key_id` — short hex fingerprint of the Ed25519 public key
- `signing_public_key` — full base64 of the same key (for self-attestation)

---

## Creating a backup

```bash
# Full backup into the current directory (auto-named by timestamp).
datashuttle backup create --output ./backups/ --config datashuttle.yaml

# Single-file backup.
datashuttle backup create \
    --output ./backups/nightly.tar.zst \
    --config /etc/datashuttle/datashuttle.yaml

# Skip audit log (smaller archive for fast DR staging).
datashuttle backup create --output ./bk.tar.zst --include registry,checkpoints,config
```

Flags:

| Flag | Default | Notes |
|------|---------|-------|
| `--output <path>` | required | File path or directory. Directory auto-names `backup-<ts>.tar.zst`. `s3://` and `gs://` are stubbed — see [Remote destinations](#remote-destinations). |
| `--config <path>` | `datashuttle.yaml` | Used to discover `server.data_dir` and `registry.url`. |
| `--include <csv>` | `registry,checkpoints,audit,config` | Subset of components. |
| `--key <path>` | `<data_dir>/crypto/ed25519.key` | Ed25519 signing key (auto-generated on first use). |

The signing key is the **same** key the audit chain uses. Back it up
separately from the archive itself — an attacker who has both your
archive and your signing key can forge a valid archive.

---

## Verifying a backup

```bash
datashuttle backup verify --from ./backup-20260414T120000Z.tar.zst \
                          --key /var/lib/datashuttle/crypto/ed25519.key
```

Verification runs in three stages:

1. **Unpack** into a `tempfile::tempdir()` scratch directory (nothing
   touches live state).
2. **Signature** — `manifest.json.sig` is checked against the signing
   key's public half. If `--key` is omitted, the key embedded in the
   manifest is trusted (self-attestation — you should pin the
   fingerprint in your runbook).
3. **Content hashes** — each `entries[]` SHA-256 is recomputed and
   compared. Any mismatch aborts.

Exit code is `0` on valid, non-zero on any failure. Scripting:

```bash
if datashuttle backup verify --from "$ARCHIVE" --key "$KEY"; then
    echo "ok"
else
    echo "archive is tampered or signed by a different key" >&2
    exit 1
fi
```

---

## Restoring

```bash
# Fresh host, empty data dir.
datashuttle backup restore \
    --from ./backup-20260414T120000Z.tar.zst \
    --to /var/lib/datashuttle \
    --key ./ed25519.key

# Force overwrite of an existing (non-empty) data dir.
datashuttle backup restore --from bk.tar.zst --to /var/lib/datashuttle --force
```

Safety rules:

- The target directory must be empty unless `--force` is passed.
- Signature + hash verification runs *before* any file is written. If
  verification fails the live data dir is untouched.
- Extraction happens under a tempdir first, then files are atomically
  moved into the target. If any single move fails, previously-placed
  files are cleaned up and the restore aborts.
- `audit/audit.jsonl.zst` is decompressed back to `audit.jsonl` during
  restore so the API server sees the expected on-disk layout.

### Restore runbook (DR)

1. Provision a fresh host with the same DataShuttle version as the
   backup (`datashuttle backup verify` prints the version recorded in
   the manifest).
2. Copy the signing key (`ed25519.key`) out of your key-management
   store onto the host at `/var/lib/datashuttle/crypto/ed25519.key`.
   Protect with mode `0600`.
3. Copy the archive (`backup-*.tar.zst`) to the host.
4. Run `datashuttle backup verify --from <archive> --key
   /var/lib/datashuttle/crypto/ed25519.key`. **Do not proceed unless
   this prints `✓ archive … verified`.**
5. Run `datashuttle backup restore --from <archive> --to
   /var/lib/datashuttle`.
6. Reconcile the redacted config — `config.redacted.yaml` inside the
   archive has secrets replaced with `<redacted>`. Merge real secret
   values from your secret store before starting the server.
7. `systemctl start datashuttle` (or equivalent). Pipelines resume
   from the checkpoints embedded in the restored registry.

---

## Listing backups

```bash
datashuttle backup list --destination /var/backups/datashuttle/
```

Emits a table with `ARCHIVE`, `SIZE`, `CREATED`, `SIGNED-BY`, and
version. Only `backup-*.tar.zst` files with a parseable manifest are
listed; malformed archives are shown with `<unreadable>`.

---

## Scheduling

DataShuttle does **not** ship an in-process backup daemon (yet — see
TODO in `crates/datashuttle-cli/src/backup_cmd.rs`). Instead, the CLI
writes a descriptor file you plug into OS cron:

```bash
datashuttle backup schedule \
    --cron "0 2 * * *" \
    --retention-days 7 \
    --destination /var/backups/datashuttle/ \
    --out /etc/datashuttle/backup-schedule.json
```

The tool prints the exact cron line to add, e.g.:

```cron
# /etc/cron.d/datashuttle-backup
0 2 * * * root datashuttle backup create --output /var/backups/datashuttle/
```

Retention is the operator's responsibility today (use `find
/var/backups/datashuttle -name 'backup-*.tar.zst' -mtime +7 -delete`).
A first-class retention sweeper is a follow-up task.

---

## Remote destinations

| URL scheme | Default build | Notes |
|------------|---------------|-------|
| `./path` / `local:///…` | ✅ Supported | Always available. |
| `s3://bucket/…` | ❌ Stubbed | Rebuild with `--features backup-s3` (planned — ships behind the existing `saas-aws` feature to keep the OSS CLI AWS-SDK-free). |
| `gs://bucket/…` | ❌ Stubbed | Rebuild with `--features backup-gcs` (planned). |

The default OSS build is deliberately free of `aws-sdk-*` /
`google-cloud-*` — run `cargo tree -p datashuttle-cli | grep -E
"aws-sdk|google-cloud"` and you'll get no output. Operators on
self-managed clusters typically pipe backups to object storage via
`rclone`, `aws s3 cp`, or `gsutil` on the cron line.

---

## Key management

Backup archives inherit their trust anchor from the same
`$DATA_DIR/crypto/ed25519.key` file the audit chain uses. Read
[Cryptographic Integrity](cryptographic-integrity.md) for the full key
lifecycle. The short version:

- First `datashuttle backup create` auto-generates the key if absent
  (mode `0600`, parent dir `0700`).
- Rotate with `datashuttle crypto rotate-key`. Archive the old key —
  backups signed before the rotation still need it to verify.
- Keep the key *off* the machine that hosts the archive. A backup plus
  its signing key is an attack-surface combo that defeats tamper-
  evidence.

---

## Retention strategy

A sample daily policy: keep 14 days of nightly backups on a dedicated
volume, then offload weekly snapshots to cold storage.

```cron
# Nightly full.
0 2 * * * root datashuttle backup create --output /srv/backups/datashuttle/

# Sunday snapshot to cold storage.
0 4 * * 0 root rclone copy /srv/backups/datashuttle/ cold:ds-backups/$(date +\%Y\%m)/

# Prune local copies > 14 days.
30 3 * * * root find /srv/backups/datashuttle -name 'backup-*.tar.zst' -mtime +14 -delete
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `backup signed by unknown key …` | Archive was signed with a different key than the one you passed to `--key`. | Point `--key` at the correct keystore, or omit `--key` to trust the embedded public key. |
| `manifest verification FAILED (N issues)` | The archive has been tampered with, or the file was truncated in transit. | Re-fetch the archive from the source of truth; do NOT restore. |
| `target data dir … is not empty` | `restore` refuses to overwrite live state. | Pick an empty target, or pass `--force` if you really mean it. |
| `S3 destination … is not available in this build` | OSS CLI was built without `backup-s3`. | Either rebuild with the feature or pipe to S3 from the cron line using `aws s3 cp`. |
