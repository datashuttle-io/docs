# GDPR Compliance

DataShuttle ships first-class support for the GDPR right to data
portability (Article 20) and right to erasure (Article 17). The same
primitives power both DataShuttle Cloud and on-prem / OSS deployments —
no external services are required.

## Quick reference

| Action              | User (UI / API)                         | Operator (CLI)                             |
| ------------------- | --------------------------------------- | ------------------------------------------ |
| Export my data      | `GET /api/v1/users/me/export`           | `datashuttle gdpr export --user-id <id>`   |
| Delete my account   | `DELETE /api/v1/users/me`               | `datashuttle gdpr forget --user-id <id>`   |
| Cancel deletion     | `POST /api/v1/users/me/restore`         | `datashuttle gdpr restore --user-id <id>`  |
| List pending        | —                                       | `datashuttle gdpr list-pending`            |

## Lifecycle

1. User or operator triggers `DELETE /api/v1/users/me`.
2. Server sets `users.deleted_at = now()` and
   `users.delete_grace_until = now() + gdpr.delete_grace_days` (default
   30 days). Returns `202 Accepted` with the grace timestamp.
3. During the grace window the user can call
   `POST /api/v1/users/me/restore` to cancel. After grace, restore is
   refused.
4. The daily sweep
   (`crate::state::AppState::spawn_gdpr_sweep`) picks up expired rows,
   hard-deletes the user, removes owned orgs with no other admins,
   removes memberships, and writes a tamper-evident
   `gdpr.hard_delete_executed` tombstone event.
5. When `gdpr.scrub_iceberg_data: true`, a
   `gdpr.iceberg_scrub_queued` event is also emitted — see
   [Iceberg PII scrub](#iceberg-pii-scrub).

## Configuration (`datashuttle.yaml`)

```yaml
gdpr:
  # URL returned to users clicking the footer "Privacy policy" link.
  # Served via GET /api/v1/legal/privacy. Omit to return 404.
  privacy_policy_url: https://your-domain.com/privacy
  # Similarly for the Data Processing Agreement.
  dpa_url: https://your-domain.com/dpa
  # Grace period before a soft-deleted user is hard-deleted.
  delete_grace_days: 30
  # Per-install secret fed into SHA-256 when computing tombstone
  # user_id hashes. Auto-generated on first use if unset.
  delete_salt: "your-per-install-random-string"
  # Optional: queue Iceberg PII rewrites when a user is hard-deleted.
  scrub_iceberg_data: false
```

## Tombstone audit events

When the sweep hard-deletes a user the audit log gains a
`gdpr.hard_delete_executed` event carrying:

| Field             | Value                                          |
| ----------------- | ---------------------------------------------- |
| `action`          | `"gdpr.hard_delete_executed"`                  |
| `resource_id`     | `sha256(user_id ‖ "|" ‖ gdpr.delete_salt)`     |
| `detail.reason`   | `expired_grace_period` or `forced_by_admin`    |
| `detail.deleted_at` | Original soft-delete timestamp               |
| `detail.grace_until` | Grace expiry                                |

The hash is one-way: SOC 2 auditors can confirm the event exists, but
the original user_id is gone for good.

## CLI walkthrough

### Export a user's data

```bash
# Default tar bundle — user.json + memberships.json + pipelines.json
# + connections.json + webhooks.json + billing.json + audit.jsonl.
datashuttle gdpr export --user-id u-123 --output /tmp/u-123.tar

# Single JSON document (matches the REST response shape).
datashuttle gdpr export --user-id u-123 --format json --output /tmp/u-123.json
```

Secrets (`password`, `secret`, `token`, `key`, `credentials`) are
redacted from connection options before export.

### Request deletion

```bash
# Dry-run first — never talks to the server.
datashuttle gdpr forget --user-id u-123 --dry-run

# Soft-delete (30-day grace).
datashuttle gdpr forget --user-id u-123

# Force: skip the grace period (operator override).
datashuttle gdpr forget --user-id u-123 --force

# Queue an Iceberg PII scrub on sweep.
datashuttle gdpr forget --user-id u-123 --scrub-data
```

### Cancel a pending deletion

```bash
datashuttle gdpr restore --user-id u-123
```

### List pending deletions

```bash
# Human-readable table.
datashuttle gdpr list-pending

# JSON lines (one event per line) for scripting.
datashuttle gdpr list-pending --json
```

## Iceberg PII scrub

Pipelines may be tagged with a `pii_columns` option listing columns
that must be NULL-ed out when a user is hard-deleted:

```sql
CREATE PIPELINE analytics_events ...
WITH (
  pii_columns = '["email","full_name","ip_address"]'
);
```

When `gdpr.scrub_iceberg_data: true`, the hard-delete sweep enqueues a
scrub request for each matching table. The scrub module
(`datashuttle_iceberg::scrub::scrub_pii_for_user`) logs the request
today; a separate scrub worker consumes the queue and performs the
rewrite.

### Legal note on Iceberg retention

Iceberg is **append-only at the metadata level**. A rewrite produces a
new snapshot; the previous snapshot still references the old data
files. To truly delete the PII, operators MUST run `expire_snapshots`
with a cutoff that includes the rewrite:

```bash
# Remove every snapshot older than the rewrite so the old PII row
# data becomes eligible for file-level GC.
datashuttle iceberg expire-snapshots --table analytics.events \
  --older-than 2024-01-15T00:00:00Z
```

GC of the orphaned Parquet files happens on the next compaction /
`remove_orphan_files` pass.

## Data retention obligations

Some records may need to live past the 30-day grace:

* **Billing / invoice records (Stripe retention)** — by law most
  jurisdictions require retaining invoices for 6–10 years. The sweep
  explicitly does NOT purge Stripe customer rows tied to tenants that
  still have outstanding invoices. Operators can override with the
  `--force` flag after consulting counsel.
* **Audit events** — the tamper-evident chain is append-only by
  design. Personally identifiable fields (original user_id) are
  hashed on hard-delete so the chain survives without becoming a GDPR
  liability.
* **Tenant data owned by other users** — when the deleted user owned
  an organization but other admins remain, the org is preserved and
  only the user's personal record is removed.

## Troubleshooting

### "grace period expired; account cannot be restored"

The daily sweep has already flagged the user for imminent purge. Wait
for the sweep to complete, then re-create the account. The old
user_id is unrecoverable by design — only the tombstone hash remains
in the audit log.

### Export returns empty `audit_events`

The audit store keeps a 10k-event in-memory ring buffer plus an
optional JSONL file. If the ring rolled, older events are in
`$DATA_DIR/audit.jsonl` and can be exported separately via
`datashuttle audit export`.

### Scrub jobs never execute

The current build emits `ScrubOutcome::Queued` — the full row-level
rewrite is a deferred item (the Iceberg writer does not yet expose a
predicate-based rewrite hook). Subscribe to issue [#560] for progress.
Operators who need an immediate rewrite today can run:

```bash
# Manual SQL-level null-out (example for Postgres-backed tables):
UPDATE analytics.events
SET email = NULL, full_name = NULL, ip_address = NULL
WHERE user_id_hash = '<sha256 from tombstone>';
```
