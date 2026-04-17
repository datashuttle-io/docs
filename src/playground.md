# Interactive Playground

The Playground is a guided, hands-on sandbox for exploring DataShuttle
end-to-end. Pick a source, click through a pre-built scenario, watch
rows land in Iceberg in real time, break the pipeline on purpose, and
replay from the dead-letter queue — all without installing anything
beyond Docker.

It ships in every deployment tier (Community, Team, Business,
Enterprise) and in every mode (Cloud, self-hosted, airgapped). Access
is gated by authentication — sign in before visiting `/playground`.

## Why use it

- **Zero real data.** Every session writes into a private namespace
  that gets torn down after two hours.
- **See every corner of the product.** The 18 scenarios cover the
  happy path, schema evolution, DLQ replay, Arrow Flight hot-buffer
  throughput, Iceberg time travel, and deliberate chaos (network
  latency, slow consumers, huge payloads).
- **Share a single URL.** Every scenario has a stable deep link —
  paste it into a sales call, a bug report, or a training doc.
- **Whitelisted actions only.** The API rejects any SQL that isn't
  listed for the current scenario, so the sandbox stays the sandbox.

## Enabling

The [Quickstart](./quickstart.md) demo bundle already ships the
playground services — start it with the `playground` profile:

```bash
# From inside the demo-bundle directory:
docker compose --profile playground up -d

# Optional — Tier 4 chaos scenarios:
docker compose --profile playground --profile chaos up -d
```

Open <http://localhost:8080/playground> and sign in.

Operator knobs:

| Environment variable           | Default  | Effect                                                  |
|--------------------------------|----------|---------------------------------------------------------|
| `DS_PLAYGROUND_ENABLED`        | `1`      | Set to `0`/`false` to disable entirely.                 |
| `DS_PLAYGROUND_MANIFEST`       | repo     | Absolute path to `manifest.json`.                       |
| `DS_PLAYGROUND_TTL_SECS`       | `7200`   | Session lifetime in seconds (min 300, max 28800).       |

## Scenario catalogue

A single manifest ships inside the demo bundle and is consumed by the
web UI, the `datashuttle playground` CLI, and this page. Eighteen
scenarios cover four tiers:

### Tier 1 — stable sources

| Scenario id                   | Source      | What it shows                                        |
|-------------------------------|-------------|------------------------------------------------------|
| `postgres-cdc-ecommerce`      | PostgreSQL  | Happy path: insert / update / delete / burst 100.    |
| `postgres-schema-evolution`   | PostgreSQL  | ADD / DROP / RENAME / type widening → Iceberg.       |
| `postgres-backfill-plus-live` | PostgreSQL  | Snapshot + live CDC run concurrently, zero gap.      |
| `clickhouse-high-cardinality` | ClickHouse  | Tune Iceberg clustering keys on 100k rows live.      |
| `clickhouse-time-travel`      | ClickHouse  | Query at timestamp, rollback to earlier snapshot.    |
| `kafka-json-poison`           | Kafka       | Inject a malformed JSON event → DLQ → replay.        |
| `kafka-throughput`            | Kafka       | 10k-event burst; Arrow Flight hot buffer <5ms p99.   |

### Tier 2 — beta sources

| Scenario id                   | Source      | What it shows                                        |
|-------------------------------|-------------|------------------------------------------------------|
| `mysql-binlog-restart`        | MySQL       | Pipeline recovers cleanly after a 30s source outage. |
| `mongodb-nested-evolution`    | MongoDB     | Adding nested fields without a restart.              |
| `file-s3-mixed-formats`       | S3 files    | CSV + JSON + Parquet into one pipeline.              |
| `file-bad-encoding`           | S3 files    | Bad UTF-8 → DLQ → re-encode → replay.                |

### Tier 3 — new playground containers

| Scenario id           | Source         | What it shows                                   |
|-----------------------|----------------|-------------------------------------------------|
| `rest-api-polling`    | WireMock       | REST polling with pagination.                   |
| `dynamodb-streams`    | DynamoDB Local | Streams + TTL-triggered tombstones.             |
| `kinesis-shards`      | LocalStack     | Shard split / merge under live load.            |
| `cassandra-wide-row`  | Cassandra      | 1000-column wide rows + batching.               |

### Tier 4 — chaos

| Scenario id       | Source / chaos tool    | What it shows                            |
|-------------------|------------------------|------------------------------------------|
| `network-chaos`   | Toxiproxy + Postgres   | 500 ms latency + 10 % packet loss.       |
| `slow-consumer`   | Kafka                  | Backpressure engages, hot buffer guard.  |
| `large-payload`   | MySQL                  | 50 MB BLOBs replicate safely.            |

## Web UI

Navigate to `/playground` in the DataShuttle web UI. The gallery shows
every scenario the current deployment permits (Tier 4 is hidden on
cloud until the `chaos` profile is live). Filters narrow by tier,
source, and status.

Clicking **Start** provisions a session:

1. A private Iceberg namespace `playground_<uhash>_<sid>` is allocated.
2. A scoped pipeline + connection are created from the scenario's
   `pipeline_sql` template.
3. You land on the runner at `/playground/<session_id>`.

The runner has three panes:

- **Actions** — whitelisted, one-click SQL / shell / HTTP operations.
- **Break it** — deliberate failure modes (drop column, inject poison
  message, network chaos). Marked with a red button; recovery is part
  of the learning experience.
- **Monitor** — the Arrow Flight hot-buffer panel (<5 ms reads),
  WebSocket event stream, and a rolling session log.

Sessions expire after two hours. The **+1h** button extends them; an
**End** tears down the pipeline + namespace immediately.

## CLI

Every UI action has a CLI equivalent — useful for automation,
reproducible demos, and shareable scripts.

```bash
# Pick a scenario:
datashuttle playground list --tier 1

# Start it:
datashuttle playground run postgres-cdc-ecommerce

# Run an action (omit --session to target your single active one):
datashuttle playground action insert-order
datashuttle playground action burst-100

# Inspect status / event log:
datashuttle playground status

# Reset scenario data without tearing down:
datashuttle playground reset

# End session:
datashuttle playground end
```

## Sharing

Every scenario has a stable deep link: `/playground/run/<scenario_id>`.
Signed-in users land on the gallery with that scenario pre-focussed
so a single URL drives sales demos, bug reports, and training.

## Security model

- **Action whitelist** — the API only accepts actions that are listed
  in the manifest for the session's scenario. Free-form SQL is
  rejected at the handler. This is a hard boundary: the manifest is
  reviewed like any other source-controlled artefact.
- **Namespace isolation** — each session writes exclusively into
  `playground_<uhash>_<sid>`. Namespaces are deterministic so a
  restart-time sweeper can reap orphan data.
- **TTL cleanup** — the API spawns a background sweep task every
  60 s; expired sessions are dropped and their pipelines + namespaces
  are torn down.
- **One session per user** — stops abusive loops and keeps the
  docker-compose box responsive.

## New scenarios

Scenarios are added to the manifest by the DataShuttle team and ship
with the next release. If you have an ingestion pattern you'd like to
see covered (a specific connector edge case, a chaos profile, a
schema-evolution corner), email <hello@datashuttle.ai> with a
reproducer and it goes on the roadmap for the next manifest rev.
