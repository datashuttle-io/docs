# Cryptographic Integrity

DataShuttle uses a single, shared Ed25519 key (`KeyStore`, in
`datashuttle-core::crypto`) to sign every artefact whose integrity
matters operationally:

- **Audit chain** — every `AuditEvent` carries an Ed25519 signature
  over its `row_hash`. See [Audit & Compliance](./audit-compliance.md).
- **Registry checkpoints** — every CDC checkpoint (`checkpoint.json`)
  is paired with a `checkpoint.json.sig` so silent corruption (cosmic
  rays, disk-controller bugs, accidental edits) trips the loader
  instead of being replayed as truth.
- **Arbitrary file signing** — operators can sign release tarballs,
  config snapshots and runbooks with the same key and verify them with
  the same toolchain.

This is the **Cross-Grade #20** delivery (#576) from the Phase 5 roadmap.
There is exactly **one key file** for the whole product, eliminating the
duplicate-key-management problem that older versions had between the
audit log and the license ledger.

## Key file layout

```
$DATA_DIR/crypto/
├── ed25519.key            # current signing key (mode 0600, 32 bytes)
└── archived-keys/
    ├── 1cc96ae8….key      # previous key pinned by fingerprint
    └── b9f1c2a4….key      # …and the one before that
```

- The key is **auto-generated** on first boot.
- File mode is enforced to `0600`; parent dirs to `0700`.
- The **fingerprint** is the first 16 hex chars of the public key —
  short enough to put in logs, long enough to be uniquely identifying.

## CLI cheat sheet

```bash
# Inspect the live key.
datashuttle crypto show
# path:        ./data/crypto/ed25519.key
# fingerprint: 1cc96ae8d5eddb07
# public_key:  AbC123…/+

# Rotate. The previous key is archived under archived-keys/.
datashuttle crypto rotate-key
# rotated key at ./data/crypto/ed25519.key
# archived old key → ./data/crypto/archived-keys/1cc96ae8d5eddb07.key
# old fingerprint: 1cc96ae8d5eddb07
# new fingerprint: 9f3acc12be4e8002

# Sign an arbitrary file.
datashuttle crypto sign release.tar.gz
# Writes release.tar.gz.sig

# Verify it elsewhere.
datashuttle crypto verify release.tar.gz
# ✓ release.tar.gz verified under key fingerprint 9f3acc12be4e8002
```

## Signed checkpoints

CDC checkpoints land at `$DATA_DIR/cdc-state/<pipeline>/checkpoint.json`.
When the same Ed25519 key from `$DATA_DIR/crypto/ed25519.key` is wired
into the checkpoint manager, every save also writes a sibling
`checkpoint.json.sig`. On load:

| Body | `.sig` file | Outcome |
|---|---|---|
| missing | — | start fresh (default state) |
| present | missing | accept body, log a WARN ("upgrade pending re-save") |
| present | valid | accept body |
| present | invalid / wrong key | **fail closed** with `CheckpointError::Other("checkpoint signature invalid (possible silent corruption)")` |

A failed verification halts pipeline startup. Operators see the
signature mismatch, restore from backup, then re-sign on next save —
no silent partial replays.

### Programmatic API

```rust
use datashuttle_cdc::checkpoint::CheckpointState;
use datashuttle_core::crypto::KeyStore;

let ks = KeyStore::load_or_create("./data/crypto/ed25519.key")?;
let state = CheckpointState::load_or_default_signed(&path, &ks)?;
// … mutate state …
state.save_signed(&path, &ks)?;
```

`load_or_default` / `save` (without `_signed`) remain available for
test code and callers that explicitly opt out of signing.

## Rotation playbook

1. Export the current public key for every external auditor / verifier:
   ```bash
   datashuttle crypto show | grep public_key
   ```
2. Verify pre-rotation segments are clean:
   ```bash
   datashuttle audit verify --file ./data/audit.jsonl --key ./data/crypto/ed25519.key
   ```
3. Run the rotation:
   ```bash
   datashuttle audit rotate-key   # rotates AND emits chain boundary event
   # OR (key-only):
   datashuttle crypto rotate-key
   ```
4. Verify the new key signs forward:
   ```bash
   curl https://datashuttle.example.com/api/v1/audit/verify
   ```
5. Distribute the new public key to verifiers; archive the
   `archived-keys/<old-fp>.key` file alongside the audit segments it
   signed (e.g. ship to S3 with the corresponding JSONL bundle).

## On-prem invariants

- `ed25519-dalek` is pure-Rust; no system OpenSSL dep added by this
  feature. The crate ships in the OSS default build.
- `KeyStore::load_or_create` never reaches the network and never
  requires an env var — the key file path defaults to
  `$DATA_DIR/crypto/ed25519.key`.
- The `crypto` and `audit` subcommands work on stock OSS builds —
  they're not gated behind any feature.
- Signing failure on save is logged as WARN and the unsigned save
  still goes through; signature failure on load is fail-closed (the
  threat model is silent corruption, not denial of service).

## Threat model in 30 seconds

| Threat | Defense |
|---|---|
| Operator with disk access tampers with `audit.jsonl` | Detected by `audit verify` — hash chain + signature. |
| Operator deletes a chunk of events | Detected by `audit verify` — `prev_hash` mismatch on the next surviving entry. |
| Operator forges a signature with a different key | Detected — `key_fingerprint` field exposes the wrong signer. |
| Silent disk corruption flips a byte in `checkpoint.json` | Detected on next pipeline start — fail-closed. |
| Stolen private key | Out of scope — rotate immediately, archive the compromised key, re-sign forward. |
| Tampering between sender and SIEM webhook | HMAC signature in `X-DataShuttle-Signature` header (when `DS_AUDIT_WEBHOOK_HMAC` is set). |
