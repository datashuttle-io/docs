# Apache Cassandra Connector

> **Tier-2 connector.** This connector lives in the
> [`datashuttle-connectors-extra`](https://github.com/evgenyestepanov-star/datashuttle-connectors-extra)
> repo and is **not** compiled into the default OSS build. To run it
> against a running OSS install, follow the
> [External Connectors operator runbook](../operations/external-connectors.md)
> — package the sidecar binary, register it in `connectors.json`, and
> the runtime registry will pick the connector type up at startup.

Continuously sync Cassandra tables to Iceberg using the Cassandra CDC log. Supports parallel reads across multiple nodes.

## Sync model

Cassandra 4.0+ supports a **CDC log** that DataShuttle tails for row-level inserts, updates, and deletes. Latency is in the seconds range.

For clusters where CDC is not enabled, DataShuttle falls back to full table scan with change detection on each scheduled run.

## Prerequisites

- Apache Cassandra 4.0+
- Enable CDC on each table you want to replicate:
  ```cql
  ALTER TABLE my_keyspace.orders WITH cdc = true;
  ```
- User with `SELECT` privilege on target tables and the `system` keyspace

## CREATE CONNECTION

```sql
CREATE CONNECTION cassandra_prod
  TYPE CASSANDRA
  PROPERTIES (
    hosts = 'node1.internal,node2.internal,node3.internal',
    port = '9042',
    keyspace = 'my_keyspace',
    username = 'datashuttle',
    password = SECRET 'vault://secrets/cassandra_pass',
    datacenter = 'datacenter1'
  );
```

### Connection properties

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `hosts` | Yes | — | Contact points (comma-separated) |
| `port` | No | `9042` | CQL native protocol port |
| `keyspace` | Yes | — | Keyspace name |
| `username` | No | — | Username |
| `password` | No | — | Password |
| `datacenter` | No | — | Local datacenter name (for DCAwareRoundRobin policy) |
| `tls` | No | `false` | Enable TLS |

## CREATE SHUTTLE

```sql
-- Continuous sync with CDC
CREATE SHUTTLE cassandra_orders
  SOURCE cassandra_prod TABLE orders
  TARGET warehouse.raw
  SCHEDULE continuous;

-- Periodic full scan (fallback without CDC)
CREATE SHUTTLE cassandra_catalog
  SOURCE cassandra_prod TABLE product_catalog
  TARGET warehouse.raw
  SCHEDULE EVERY '1 hour';
```

## Type mapping

| Cassandra | Arrow | Iceberg |
|-----------|-------|---------|
| `boolean` | Boolean | `boolean` |
| `tinyint` | Int8 | `int` |
| `smallint` | Int16 | `int` |
| `int` | Int32 | `int` |
| `bigint` | Int64 | `long` |
| `counter` | Int64 | `long` |
| `float` | Float32 | `float` |
| `double` | Float64 | `double` |
| `decimal` | Decimal128(38,9) | `decimal(38,9)` |
| `varint` | Utf8 | `string` |
| `text` / `varchar` / `ascii` | Utf8 | `string` |
| `blob` | Binary | `binary` |
| `date` | Date32 | `date` |
| `time` | Time64(ns) | `time` |
| `timestamp` | Timestamp(ms, UTC) | `timestamptz` |
| `duration` | Utf8 | `string` |
| `uuid` / `timeuuid` | Utf8 | `string` |
| `inet` | Utf8 | `string` |
| `list<T>` | Utf8 | `string` (JSON) |
| `set<T>` | Utf8 | `string` (JSON) |
| `map<K,V>` | Utf8 | `string` (JSON) |
| `frozen<T>` | Utf8 | `string` (JSON) |
| `tuple<...>` | Utf8 | `string` (JSON) |
| UDT | Utf8 | `string` (JSON) |

## Limitations

- CDC log retention: Cassandra purges CDC segments based on `cdc_total_space_in_mb`. If the shuttle is paused longer than the available CDC window, a full resync is triggered.
- Collection types (`list`, `set`, `map`, UDT, `frozen`) are serialized as JSON strings.
- `varint` (arbitrary-precision integer) is serialized as a string to avoid precision loss.
- `counter` tables in Cassandra cannot be replicated via CDC in the same way as regular tables — counter values represent totals, not deltas. Full scan is used for counter tables.
