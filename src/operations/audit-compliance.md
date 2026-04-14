# Audit & Compliance

DataShuttle ships a **tamper-evident audit chain** out of the box. Every
admin action — pipeline create / drop, settings change, drain trigger,
SSO callback, login, logout, password reset request — is recorded as a
structured `AuditEvent` and woven into an Ed25519-signed hash chain.

The chain is delivered as a **cross-grade** to OSS users (#563): the
same audit infrastructure that backs SOC 2 Type II for DataShuttle
Cloud lights up automatically for self-managed deployments, with no
additional configuration.

## What you get

- **Immutability via hash chain.** Each event carries `prev_hash` and
  `row_hash = sha256(prev_hash || canonical_json(event))`. Inserting,
  deleting or modifying a single event breaks the chain — verifiers
  detect the exact event that was tampered.
- **Authenticity via Ed25519 signature.** The `row_hash` is signed
  with a per-deployment Ed25519 key
  (`$DATA_DIR/crypto/ed25519.key`, mode 0600). Auditors who hold the
  public key can verify the chain offline.
- **Persistence.** Events are written to `$DATA_DIR/audit.jsonl` with
  fsync per record so a crash never loses recent entries.
- **Optional SIEM mirroring** (webhook / RFC 5424 syslog).

## Anatomy of an event

```json
{
  "id": "39e7c7e0-…",
  "timestamp": "2026-04-14T18:25:00.123Z",
  "action": "create_pipeline",
  "user_id": "alice@acme",
  "tenant_id": "tenant-acme",
  "resource_type": "pipeline",
  "resource_id": "orders-cdc",
  "result": "success",
  "ip_address": "10.1.2.3",
  "detail": { "source": "postgres", "table": "public.orders" },
  "prev_hash": "5c5c…",
  "row_hash": "f1b8…",
  "signature": "MEUCIQDr…",
  "key_fingerprint": "1cc96ae8d5eddb07"
}
```

The `prev_hash` / `row_hash` / `signature` / `key_fingerprint` fields
are the cross-grade additions. Pre-Phase-5 events (no chain fields)
remain readable — the verifier passes them through as legacy entries.

## Verifying the chain

### Online — REST endpoint

```bash
curl -H "Authorization: Bearer $DS_TOKEN" \
  https://datashuttle.example.com/api/v1/audit/verify
```

Returns `200 OK` with `{ "result": { "status": "ok", "verified_count": N } }`
on intact chains, or `422 Unprocessable Entity` with the offending
event id when tampering is detected.

Two companion endpoints help auditors:

```bash
# Public-key fingerprint + base64 (give to external auditor).
curl https://datashuttle.example.com/api/v1/audit/signing-key

# Rotate the signing key. Records an `audit_chain_rotated` boundary
# event so verifiers know where the previous key stopped signing.
curl -X POST https://datashuttle.example.com/api/v1/audit/rotate-key
```

### Offline — CLI

For air-gapped audits / archived JSONL segments:

```bash
datashuttle audit verify \
  --file ./data/audit.jsonl \
  --key  ./data/crypto/ed25519.key
```

Exits `0` on intact chain. Non-zero with a clear stderr message on
tamper. Operators stamping deliveries to compliance officers can pipe
the same JSONL file through `datashuttle audit export --format cef`
(ArcSight CEF) or `--format json-lines` (Splunk / Elastic) with no
loss of fidelity — both formats embed the chain fields verbatim.

### Rotating the audit key

```bash
# Recommended (CLI): writes a chain-boundary event to the JSONL log
# AND rotates the on-disk key file in one shot.
datashuttle audit rotate-key \
  --file ./data/audit.jsonl \
  --key  ./data/crypto/ed25519.key

# Or via API (also writes the boundary event):
curl -X POST https://datashuttle.example.com/api/v1/audit/rotate-key
```

The previous key is preserved by `datashuttle crypto rotate-key`
(see [Cryptographic Integrity](./cryptographic-integrity.md)). Archive
those files alongside the corresponding JSONL segments so future audits
can verify pre-rotation entries.

## Mirroring to a SIEM

Set environment variables on the API server. Each sink is independent
and additive — turning on the syslog sink doesn't disable the JSONL
log; it just replicates the stream.

| Variable | Effect |
|---|---|
| `DS_AUDIT_WEBHOOK_URL` | POST every event to this URL as JSON. |
| `DS_AUDIT_WEBHOOK_BEARER` | Optional bearer token attached to each POST. |
| `DS_AUDIT_WEBHOOK_HMAC` | Optional HMAC-SHA256 secret. The hex digest of the body is sent in `X-DataShuttle-Signature`. |
| `DS_AUDIT_SYSLOG_TARGET` | RFC 5424 UDP target (`host:port`). Facility 13 (audit), severity 5 (notice). |

Sink failures **never block the audit pipeline** — every per-sink error
is logged at WARN with the offending `event.id` and `sink.label()`. The
in-memory ring buffer + JSONL log remain authoritative.

### Webhook payload sketch

```http
POST /audit-events HTTP/1.1
Authorization: Bearer ${DS_AUDIT_WEBHOOK_BEARER}
X-DataShuttle-Signature: 8f3a…  # only when DS_AUDIT_WEBHOOK_HMAC is set
Content-Type: application/json

{ … same JSON shape as the JSONL line … }
```

### Syslog datagram sketch

```
<109>1 2026-04-14T18:25:00.123Z prod-pod-3 datashuttle - - - {"id":"39e7c7e0-…", …}
```

`<109>` decodes to `facility=13 (audit) | severity=5 (notice)`.

## Compliance posture

| Framework | Coverage |
|---|---|
| SOC 2 Type II — *Audit log immutability* | ✅ Hash chain + Ed25519 signature. `verify` endpoint surfaces tamper events. |
| SOC 2 Type II — *Privileged action logging* | ✅ Every admin action emits an `AuditEvent` via the `audit_log!` macro. |
| HIPAA §164.312(b) — *Audit controls* | ✅ Tamper-evident persistent log; offline verifiable. |
| FINRA SEA Rule 17a-4 — *WORM-equivalent* | ⚠️ JSONL append-only is WORM in spirit; combine with object-storage retention policies for full compliance. |
| GDPR Art. 30 — *Records of processing activities* | ✅ Every tenant-scoped action carries `tenant_id`, `user_id`, `timestamp`, `ip_address`, `user_agent`. |

## Key files (`$DATA_DIR`)

```
$DATA_DIR/
├── audit.jsonl                # tamper-evident audit log (append-only, fsynced)
├── crypto/
│   ├── ed25519.key            # current signing key (mode 0600)
│   └── archived-keys/
│       └── 1cc96ae8….key      # previous keys (mode 0600); kept after rotation
└── …
```

## Failure modes

- **Signing-key file missing.** Server logs a WARN at startup and
  falls back to **unsigned** audit events (legacy mode). The `audit
  verify` endpoint returns `disabled` — not an error, but a clear
  signal to the operator to fix it.
- **Disk full / write failure.** `record()` logs WARN; the JSONL line
  is dropped, but the in-memory ring buffer + downstream sinks still
  receive the event.
- **Sink unreachable.** Per-sink WARN; the audit chain itself is
  unaffected.
