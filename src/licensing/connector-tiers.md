# Connector Tiers — Tier-1 (Community) vs Tier-2 (Team+)

> M29 Phase 39 / SITE-06. The definitive reference for which connectors
> ship under which license tier. The license-enforcement gate in the
> connector supervisor is the runtime authority; this document is the
> human-readable explanation of that gate.
>
> If this list ever drifts from `crates/datashuttle-license/src/tier.rs`,
> that file is canonical. The supervisor's Tier-2 refusal path checks
> set membership against the `TIER_1_CONNECTORS` slice declared there;
> this document mirrors it.

## Overview

DataShuttle ships **24 connector binaries** across Linux amd64, Linux
arm64, and macOS arm64. The supervisor classifies each binary as one of:

- **Tier-1 (4 connectors)** — free under the Community license. Always
  spawnable; no license file required.
- **Tier-2 (20 connectors)** — require a Team, Business, or Enterprise
  license. The supervisor refuses to spawn them under Community with a
  structured, non-fatal `TierUnavailable` error (the engine keeps
  running; only the offending spawn is refused).

The classification is **runtime-enforced** by
`crates/datashuttle-connector-supervisor/src/tier_gate.rs` against the
canonical list in `crates/datashuttle-license/src/tier.rs:27`
(`TIER_1_CONNECTORS = &["postgres", "kafka", "file", "rest-api"]`).

## Tier-1 (free, Community)

The four connectors below are licensed for use under the OSS Community
tier. The Community license is the default — no license file is
required.

| Connector | Description | Notes |
|---|---|---|
| `postgres` | PostgreSQL CDC source + sink | Logical replication slot. Production sidecar. |
| `kafka` | Kafka source (kafka-native librdkafka build) | macOS arm64 ships conditionally — see [macOS arm64 caveat](#macos-arm64-caveat) below. |
| `file` | File-based source / sink (S3, GCS, ADLS, local) | Pluggable via `object_store`. |
| `rest-api` | REST API source | HTTP polling with backoff. |

Source: `crates/datashuttle-license/src/tier.rs:27`
(`TIER_1_CONNECTORS`). This constant is the single source of truth;
both the license verifier and the connector-supervisor `spawn()` gate
check membership against it. Reordering or extending the list requires
a new A-XX lock per the M29 phase-decision discipline.

## Tier-2 (Team+, 20 connectors)

The 20 connectors below are physically present in every install (staged
in the `connectors-shared` volume by `connectors-init`) but the
**supervisor refuses to spawn them** without a Team+ license.

| Connector | Source / Sink | Notes |
|---|---|---|
| `bigquery` | sink | Google BigQuery destination. |
| `cassandra` | source | Apache Cassandra ≥ 4.x. |
| `clickhouse` | source / sink | ClickHouse OLAP. |
| `cloud-storage` | source / sink | GCS-native variant of the file connector. |
| `cockroachdb` | source | Postgres-family; CDC changefeeds. |
| `databricks` | sink | Unity Catalog supported. |
| `dynamodb` | source | DynamoDB Streams (AWS). |
| `greenplum` | source | Postgres-family. |
| `hadoop` | source | HDFS / Hive. |
| `kinesis` | source | AWS Kinesis Data Streams. |
| `mongodb` | source | Change Streams. |
| `mysql` | source | Binlog-based CDC. |
| `oracle` | source | LogMiner. |
| `pgfamily` | source | Shared base for cockroachdb / greenplum / redshift / vertica. |
| `redis` | source | Redis Streams. |
| `redshift` | source / sink | Postgres-family. |
| `snowflake` | source / sink | Snowflake warehouse. |
| `sqlserver` | source | CDC + change-tracking. |
| `starrocks` | sink | StarRocks OLAP. |
| `vertica` | source | Postgres-family. |

Source: `connectors-extra/Cargo.toml:2-22` workspace members
(alphabetised). The COUNT (20) and the LIST are non-negotiable; the
per-row capability text is best-effort and may be tightened by future
edits.

## Graceful enforcement

If the active license tier is Community and a shuttle declares a Tier-2
source, the supervisor refuses to spawn the sidecar with a structured,
non-fatal `TierUnavailable` error. Example refusal for `snowflake`:

> `Tier-2 connector 'snowflake' requires Team license; see https://datashuttle.ai/pricing`

This is **graceful enforcement** (LIC-03 / M29 Phase 34): the engine
continues serving Tier-1 shuttles **without restart** — only the
offending Tier-2 spawn is refused. The `api-server` stays up. Other
shuttles (including running Tier-1 ones) are unaffected. There is no
panic, no `process::exit`, no restart loop.

The refusal message above is **byte-identical** to the string emitted
by `crates/datashuttle-connector-supervisor/src/tier_gate.rs` — an
operator grepping product logs for `Tier-2 connector` will hit both the
source and this document, so the in-product error and the docs stay
link-aligned.

## Upgrading

To enable Tier-2 connectors:

1. Obtain a Team+ license per [Pricing](https://datashuttle.ai/pricing).
2. Mount the signed license file at `/etc/datashuttle/license.key`
   (env var `DS_LICENSE_FILE` overrides the path).
3. Restart the engine. Tier-2 spawns are immediately re-enabled.

Example (Docker Compose stack from
[`docs/install/onprem.md`](../install/onprem.md)):

```bash
docker compose restart datashuttle
```

The engine re-reads the license file at startup; restart the
`datashuttle` service to apply.

See [`docs/LICENSING.md`](../LICENSING.md) for the full licensing guide
(DPU metering, hot-reload, airgapped mode) and
[`docs/BUSINESS-MODEL.md`](../BUSINESS-MODEL.md) § 3.2 for the list-price
matrix.

## macOS arm64 caveat

The `kafka` connector on macOS arm64 builds against host `librdkafka`
via `cmake-build`. If `librdkafka` is missing at release-build time, the
release workflow falls back to **omitting the kafka tarball from the
macOS leg** (M29 Phase 36 marker disclosure). The Linux amd64 and Linux
arm64 builds ship kafka unconditionally.

To enable kafka-native locally on Apple Silicon:

```bash
brew install librdkafka cmake
```

Then re-fetch the install bundle from
<https://github.com/datashuttle-io/releases/releases/latest>.

This caveat applies only to `kafka` on macOS arm64. The other three
Tier-1 connectors (`postgres`, `file`, `rest-api`) ship unconditionally
across all three platforms (Linux amd64, Linux arm64, macOS arm64).
