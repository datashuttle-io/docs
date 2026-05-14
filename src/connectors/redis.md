# Redis Streams Connector

> **Tier-2 connector.** This connector lives in the
> [`datashuttle-connectors-extra`](https://github.com/evgenyestepanov-star/datashuttle-connectors-extra)
> repo and is **not** compiled into the default OSS build. To run it
> against a running OSS install, follow the
> [External Connectors operator runbook](../operations/external-connectors.md)
> — package the sidecar binary, register it in `connectors.json`, and
> the runtime registry will pick the connector type up at startup.

Stream Redis Streams entries into Apache Iceberg.

## Sync model

The connector is a Redis Streams source — both snapshot and CDC modes
are XADD-stream-aware:

- **Snapshot.** Pages through each configured stream key with
  successive `XRANGE` calls until the page is partial.
- **CDC.** Runs a long-lived `XREADGROUP` loop per `(stream,
  consumer)` pair and emits batches as canonical
  `CDCEvent`-encoded `event_json` rows. Effective fan-out is
  `min(parallelism_hint, parallel_consumers)` — see [config](#config).

The wire schema is derived from `field_types`: declared columns get
typed Arrow representation; everything else lands in a catch-all
`fields_json` Utf8 column. Reserved column names are `stream_key`,
`stream_id`, and `fields_json`.

## Prerequisites

- Redis 5.0+ (Streams type required).
- For CDC: a consumer group on each stream — created by the connector
  if missing.
- For sentinel topology: a configured Sentinel master name + at least
  one Sentinel address.
- Cluster topology is **not yet implemented** — declared but rejected
  at config validation.

## Connection example

```sql
CREATE CONNECTION redis_prod
  TYPE REDIS
  WITH (
    host = 'redis.internal',
    port = 6379,
    database = 0,
    username = 'datashuttle',
    password = secret://aws-sm/prod/redis#password,
    ssl_mode = 'require',
    topology = 'standalone'
  );
```

## Shuttle example

```sql
CREATE SHUTTLE orders_events
  SOURCE redis_prod TABLES ('orders:events')
  TARGET warehouse.events
  SCHEDULE continuous
  WITH (
    from_id = '-',                       -- start at beginning of the stream
    batch_size = 1000,
    parallel_consumers = 4,
    field_types = '{"order_id":"int64","total_cents":"int64","is_paid":"bool"}'
  );
```

## Config

| Property | Default | Notes |
|---|---|---|
| `host` | _required_ | Redis hostname |
| `port` | `6379` | TCP port |
| `database` | `0` | `SELECT` target on connect (0-15) |
| `username` | _empty_ | ACL username; empty for no-auth and legacy AUTH-by-password |
| `ssl_mode` | `disable` | `disable` or `require` |
| `topology` | `standalone` | `standalone`, `sentinel`; `cluster` declared but rejected |
| `sentinel_addrs` | — | Sentinel `host:port` list (array or comma-separated string); required when `topology = sentinel` |
| `master_name` | — | Sentinel master name; required when `topology = sentinel` |
| `from_id` | `-` | Inclusive starting stream id; `-` = beginning, `<ms>-<seq>` resumes from there. `$` is rejected (no live-tail-only mode). |
| `batch_size` | `1000` | `XRANGE` `COUNT` per page (1-100 000) |
| `parallel_consumers` | `1` | CDC max consumers per stream key (1-64) |
| `field_types` | `{}` | Per-field Arrow typing: `int64`, `float64`, `bool`, `string`, `json`. Object form is order-preserving; array form is `[["name","type"], …]`. |

Anything not in `field_types` is captured into `fields_json` so schema
evolution is purely additive on the consumer side.

## Playground scenario

The `redis-streams-events` cloud-eligible scenario is the live
demo for this connector. See the
[`datashuttle-playground` docs](https://github.com/evgenyestepanov-star/datashuttle-playground/blob/main/docs/playground.md)
for the actions and expected output.

## Limitations

- `cluster` topology is not implemented yet — set `standalone` or `sentinel`.
- `from_id = '$'` is rejected — the snapshot path must converge before
  CDC kicks in.
- The connector emits raw entry payloads; downstream transforms
  (`crate::transform`) handle deduplication / collapsing.

## See also

- OSS [Connector limitations](https://github.com/evgenyestepanov-star/datashuttle/blob/main/docs/CONNECTOR-LIMITATIONS.md) — caveats shared across all Tier-2 connectors.
- OSS [External Connectors](../operations/external-connectors.md) — installation & operations.
- OSS [Connector SDK protocol](https://github.com/evgenyestepanov-star/datashuttle/blob/main/docs/connectors/protocol.md) — the wire contract.
