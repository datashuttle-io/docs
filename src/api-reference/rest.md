# REST API

Base URL: `http://<host>:8080`

## Authentication

Configure in `datashuttle.yaml` under `security.auth`:

| Mode | Header | Description |
|------|--------|-------------|
| `none` | — | No auth required (default) |
| `basic` | `Authorization: Basic <base64(user:pass)>` | HTTP Basic |
| `api_key` | `Authorization: Bearer <key>` or `X-API-Key: <key>` | API key |
| `jwt` | `Authorization: Bearer <jwt>` | JWT token |

`/health` and `/metrics` always bypass authentication.

---

## Shuttles

### List shuttles

```bash
curl http://localhost:8080/api/v1/shuttles

# Filter by status
curl http://localhost:8080/api/v1/shuttles?status=running
```

**Response** `200 OK`:

```json
[
  {
    "name": "orders_sync",
    "connection": "crm_prod",
    "target": "warehouse.raw",
    "schedule": "continuous",
    "state": "running",
    "owner": "node-1",
    "table_count": 3,
    "created_at": "2026-03-27T10:00:00Z"
  }
]
```

### Create shuttle

```bash
curl -X POST http://localhost:8080/api/v1/shuttles \
  -H 'Content-Type: application/json' \
  -d '{"sql": "CREATE SHUTTLE orders_sync SOURCE crm_prod TABLE orders TARGET warehouse.raw"}'
```

**Response** `201 Created` — full shuttle record.

### Get shuttle details

```bash
curl http://localhost:8080/api/v1/shuttles/orders_sync
```

**Response** `200 OK` — full shuttle record with options, tables, schedule, and definition SQL.

### Drop shuttle

```bash
curl -X DELETE http://localhost:8080/api/v1/shuttles/orders_sync
```

**Response** `204 No Content`

### Pause / Resume

```bash
curl -X POST http://localhost:8080/api/v1/shuttles/orders_sync/pause
curl -X POST http://localhost:8080/api/v1/shuttles/orders_sync/resume
```

**Response** `200 OK` — updated shuttle record.

### Shuttle status

```bash
curl http://localhost:8080/api/v1/shuttles/orders_sync/status
```

**Response** `200 OK`:

```json
{
  "name": "orders_sync",
  "state": "running",
  "owner": "node-1",
  "rows_per_second": 8234.0,
  "bytes_per_second": 4117000.0,
  "lag_seconds": 4.2,
  "error_message": null,
  "last_commit_at": "2026-03-27T18:00:00Z",
  "snapshot_progress": null
}
```

### Shuttle history

```bash
curl http://localhost:8080/api/v1/shuttles/orders_sync/history?limit=10
```

### Shuttle clustering

Read or modify the partition layout and sort order for an existing
shuttle. See the
[Partitioning & Clustering chapter](../concepts/partitioning-clustering.md)
for the conceptual background.

Clustering is stored **per destination table**: every entry in the
`tables` map is keyed on a fully qualified source table name (e.g.
`"analytics.events"`) and carries its own partition layout and sort
order. The special empty-string key `""` is the shuttle-wide default
applied to any table without a specific entry.

#### Get clustering

```bash
curl http://localhost:8080/api/v1/shuttles/events/clustering
```

**Response** `200 OK`:

```json
{
  "tables": {
    "": {
      "partition_spec": {
        "fields": [
          { "column": "event_ts", "transform": "Day", "name": null }
        ]
      },
      "sort_order": null
    },
    "analytics.events": {
      "partition_spec": {
        "fields": [
          { "column": "event_ts", "transform": "Day", "name": null },
          { "column": "user_id", "transform": { "Bucket": 16 }, "name": "user_bucket" }
        ]
      },
      "sort_order": {
        "fields": [
          {
            "column": "event_ts",
            "transform": "Identity",
            "direction": "Desc",
            "null_order": "NullsFirst"
          }
        ]
      }
    }
  }
}
```

Either `partition_spec` or `sort_order` is `null` when not configured
for a given entry. Transforms serialise as the Rust enum format:
`"Identity"`, `"Year"`, `"Month"`, `"Day"`, `"Hour"`,
`{ "Bucket": 16 }`, or `{ "Truncate": 8 }`.

#### Update clustering

`PUT` is a **wholesale replace** — any previously configured per-table
or default entries not present in the request body are cleared.

```bash
curl -X PUT http://localhost:8080/api/v1/shuttles/events/clustering \
  -H 'Content-Type: application/json' \
  -d '{
    "tables": {
      "": {
        "partition_spec": {
          "fields": [
            { "column": "event_ts", "transform": "Day", "name": null }
          ]
        }
      },
      "analytics.events": {
        "sort_order": {
          "fields": [
            {
              "column": "event_ts",
              "transform": "Identity",
              "direction": "Desc",
              "null_order": "NullsFirst"
            }
          ]
        }
      }
    },
    "apply_to_existing_tables": true
  }'
```

**Body fields**:

| Field | Type | Description |
|---|---|---|
| `tables` | object | Required. Map keyed on fully qualified source table name. The empty string `""` is the shuttle-wide default. Each value is `{ partition_spec, sort_order }`; either sub-field may be `null`. |
| `apply_to_existing_tables` | bool, default `false` | If true, push the **effective** sort order onto every existing Iceberg table the shuttle writes to via Iceberg `UpdateTable`. Effective order = per-table entry if present, otherwise the default. Existing data files are *not* rewritten — only future writes use the new order. Partition spec changes never affect existing tables. |

**Response** on success: same shape as `GET`, reflecting the persisted
state after the update.

**Response** `207 Multi-Status` if `apply_to_existing_tables` was true
and at least one per-table `UpdateTable` failed:

```json
{
  "error": "registry updated; 1 of 3 live ALTER calls failed: orders: ..."
}
```

The registry is always updated first, so the `GET` endpoint reflects
the new layout even when some live ALTERs failed.

### Shuttle lineage

Returns source tables, destination Iceberg tables, and per-table edges for a shuttle.

```bash
curl http://localhost:8080/api/v1/shuttles/orders_sync/lineage
```

**Response** `200 OK`:

```json
{
  "shuttle": "orders_sync",
  "connection": "crm_prod",
  "schedule": "continuous",
  "state": "running",
  "source_tables": [
    {
      "schema": "public",
      "table": "orders",
      "primary_key": ["id"]
    }
  ],
  "dest_tables": [
    {
      "namespace": "warehouse.raw",
      "table": "orders"
    }
  ],
  "edges": [
    {
      "source_table": "public.orders",
      "dest_table": "warehouse.raw.orders"
    }
  ]
}
```

---

## Connections

### List connections

```bash
curl http://localhost:8080/api/v1/connections
```

### Create connection

```bash
curl -X POST http://localhost:8080/api/v1/connections \
  -H 'Content-Type: application/json' \
  -d '{"sql": "CREATE CONNECTION crm_prod TYPE POSTGRES PROPERTIES (host = '\''db.internal'\'', port = '\''5432'\'', database = '\''production'\'', username = '\''cdc_user'\'', password = '\''secret'\'')"}'
```

### Get connection

```bash
curl http://localhost:8080/api/v1/connections/crm_prod
```

### Delete connection

```bash
curl -X DELETE http://localhost:8080/api/v1/connections/crm_prod
```

### Connection status

```bash
curl http://localhost:8080/api/v1/connections/crm_prod/status
```

**Response** `200 OK`:

```json
{
  "name": "crm_prod",
  "connection_type": "POSTGRES",
  "is_reachable": true,
  "dependent_shuttles": ["orders_sync", "users_cdc"],
  "error_message": null
}
```

### Discover connection tables

Lists tables available in the source database.

```bash
curl http://localhost:8080/api/v1/connections/crm_prod/tables
```

**Response** `200 OK`:

```json
[
  {
    "schema": "public",
    "name": "orders",
    "primary_key": ["id"]
  },
  {
    "schema": "public",
    "name": "customers",
    "primary_key": ["id"]
  }
]
```

### Discover table schema

Returns column metadata for a specific table. Used by the shuttle creation wizard.

```bash
curl http://localhost:8080/api/v1/connections/crm_prod/tables/public/orders/schema
```

**Response** `200 OK`:

```json
[
  {
    "name": "id",
    "source_type": "int4",
    "iceberg_type": "Int",
    "nullable": false,
    "is_primary_key": true
  },
  {
    "name": "status",
    "source_type": "varchar",
    "iceberg_type": "String",
    "nullable": false,
    "is_primary_key": false
  }
]
```

### Connection type mapping

Returns the default source-to-Iceberg type mapping for the connector behind a connection.

```bash
curl http://localhost:8080/api/v1/connections/crm_prod/type-mapping
```

**Response** `200 OK`:

```json
{
  "connector_type": "POSTGRES",
  "mappings": [
    {
      "source_type": "integer / int4",
      "iceberg_type": "Int",
      "alternatives": ["Long", "String"]
    },
    {
      "source_type": "text / varchar / char",
      "iceberg_type": "String",
      "alternatives": []
    }
  ]
}
```

---

## Catalog

### List catalogs

```bash
curl http://localhost:8080/api/v1/catalog/catalogs
```

### List namespaces

```bash
curl http://localhost:8080/api/v1/catalog/namespaces
```

### Iceberg table metadata

Fetches table metadata from the Polaris/Iceberg REST catalog — snapshot ID, record count, file count, schema, partition spec, format version.

```bash
curl http://localhost:8080/api/v1/catalog/tables/raw/orders/metadata
```

**Response** `200 OK`:

```json
{
  "namespace": "raw",
  "table": "orders",
  "current_snapshot_id": "3497810539823",
  "total_records": 1247893,
  "file_count": 42,
  "partition_spec": ["month(created_at)"],
  "schema_fields": [
    { "name": "id", "field_type": "long", "required": true },
    { "name": "amount", "field_type": "decimal(10,2)", "required": false },
    { "name": "created_at", "field_type": "timestamptz", "required": true }
  ],
  "last_updated": "2026-03-30T12:00:00Z",
  "format_version": 3
}
```

### Table dependents

Queries the catalog for downstream views or tables that reference an Iceberg table.

```bash
curl http://localhost:8080/api/v1/catalog/tables/raw/orders/dependents
```

**Response** `200 OK`:

```json
[
  {
    "name": "orders_summary",
    "dependent_type": "view",
    "namespace": "raw"
  }
]
```

Returns an empty array if the catalog does not support lineage metadata.

---

## Connectors

### List connector types

Lists all registered connector types and their capabilities.

```bash
curl http://localhost:8080/api/v1/connectors
```

**Response** `200 OK`:

```json
[
  {
    "type_name": "postgres",
    "display_name": "PostgreSQL",
    "capabilities": {
      "cdc": true,
      "snapshot": true,
      "schema_evolution": true,
      "parallel_snapshot": true,
      "transaction_boundaries": true
    },
    "config_fields": [
      { "name": "host", "description": "Database host", "required": true, "secret": false },
      { "name": "password", "description": "Database password", "required": true, "secret": true }
    ]
  }
]
```

### Register connector

```bash
curl -X POST http://localhost:8080/api/v1/connectors \
  -H 'Content-Type: application/json' \
  -d '{"type_name": "custom_source", "display_name": "Custom Source"}'
```

### Remove connector

```bash
curl -X DELETE http://localhost:8080/api/v1/connectors/custom_source
```

---

## Monitoring

### Monitoring stats

Aggregate metrics across all shuttles.

```bash
curl http://localhost:8080/api/v1/monitoring/stats
```

**Response** `200 OK`:

```json
{
  "total_shuttles": 12,
  "by_state": {
    "created": 0,
    "snapshotting": 1,
    "running": 8,
    "paused": 2,
    "error": 1,
    "unassigned": 0
  },
  "aggregate_rows_per_second": 142000,
  "aggregate_bytes_per_second": 71000000,
  "shuttle_metrics": [
    {
      "name": "orders_sync",
      "state": "running",
      "rows_per_second": 8234,
      "bytes_per_second": 4117000,
      "lag_seconds": 4.2,
      "error_message": null,
      "last_commit_at": "2026-03-30T12:00:00Z",
      "snapshot_progress": null
    }
  ],
  "total_tables": 47,
  "node_count": 3,
  "resource_pools": [
    {
      "name": "default",
      "mode": "shared",
      "priority": "medium",
      "active_shuttles": 8,
      "max_shuttles": 0,
      "active_snapshots": 1,
      "max_snapshots": 0,
      "node_count": 0
    },
    {
      "name": "critical",
      "mode": "dedicated",
      "priority": "high",
      "active_shuttles": 4,
      "max_shuttles": 10,
      "active_snapshots": 0,
      "max_snapshots": 3,
      "node_count": 2
    }
  ]
}
```

---

## Resource Pools

### List pools

```bash
curl http://localhost:8080/api/v1/resource-pools
```

**Response** `200 OK`:

```json
[
  {
    "name": "default",
    "mode": "shared",
    "nodes": [],
    "priority": "medium",
    "limits": { "max_shuttles": 0, "max_concurrent_snapshots": 0, "max_memory_per_shuttle_mb": 0, "max_cpu_percent_per_shuttle": 0, "io_bandwidth_mbps": 0 },
    "shuttle_count": 5,
    "active_shuttles": ["orders_sync", "users_sync"]
  }
]
```

### Create pool

```bash
curl -X POST http://localhost:8080/api/v1/resource-pools \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "critical",
    "mode": "dedicated",
    "priority": "high",
    "nodes": ["node-1", "node-2"],
    "limits": { "max_shuttles": 10, "max_concurrent_snapshots": 3 }
  }'
```

**Response** `201 Created`

### Update pool

```bash
curl -X PUT http://localhost:8080/api/v1/resource-pools/critical \
  -H 'Content-Type: application/json' \
  -d '{"name": "critical", "limits": {"max_shuttles": 20}}'
```

### Delete pool

```bash
curl -X DELETE http://localhost:8080/api/v1/resource-pools/critical
```

**Response** `204 No Content`. Fails with `409 Conflict` if shuttles are assigned.

### Pool nodes

```bash
curl http://localhost:8080/api/v1/resource-pools/critical/nodes
```

### Reassign shuttle to pool

```bash
curl -X PUT http://localhost:8080/api/v1/shuttles/orders_sync/pool \
  -H 'Content-Type: application/json' \
  -d '{"pool": "critical"}'
```

---

## SQL Execution

### Execute SQL

General-purpose SQL execution endpoint. Supports all DDL statements (`CREATE SHUTTLE`, `CREATE CONNECTION`, `SHOW SHUTTLES`, etc.).

```bash
curl -X POST http://localhost:8080/api/v1/sql \
  -H 'Content-Type: application/json' \
  -d '{"sql": "SHOW SHUTTLES"}'
```

---

## Settings

### Get server settings

```bash
curl http://localhost:8080/api/v1/settings
```

Returns catalog, storage, auth, and shuttle default configuration.

### Update settings

```bash
# Catalog settings
curl -X PUT http://localhost:8080/api/v1/settings/catalog \
  -H 'Content-Type: application/json' \
  -d '{"catalog_uri": "http://polaris:8181/api/catalog", "catalog_name": "warehouse"}'

# Storage settings
curl -X PUT http://localhost:8080/api/v1/settings/storage \
  -H 'Content-Type: application/json' \
  -d '{"endpoint": "http://minio:9000", "region": "us-east-1"}'

# Shuttle defaults
curl -X PUT http://localhost:8080/api/v1/settings/shuttle_defaults \
  -H 'Content-Type: application/json' \
  -d '{"commit_interval": "30 seconds", "iceberg_format_version": 3}'

# Auth settings
curl -X PUT http://localhost:8080/api/v1/settings/auth \
  -H 'Content-Type: application/json' \
  -d '{"mode": "api_key"}'
```

### Test connections

```bash
# Test catalog connectivity
curl -X POST http://localhost:8080/api/v1/settings/catalog/test

# Test storage connectivity
curl -X POST http://localhost:8080/api/v1/settings/storage/test
```

---

## Cluster

### Cluster status

```bash
curl http://localhost:8080/api/v1/cluster/status
```

### Node list

```bash
curl http://localhost:8080/api/v1/cluster/nodes
```

### Version

```bash
curl http://localhost:8080/api/v1/version
```

**Response** `200 OK`:

```json
{
  "version": "0.1.0",
  "iceberg_format": "V3",
  "rust_version": "1.82.0"
}
```

---

## Dead letters

### List dead letters

```bash
curl http://localhost:8080/api/v1/deadletters/orders_sync
```

### Replay dead letters

```bash
curl -X POST http://localhost:8080/api/v1/deadletters/orders_sync/replay
```

### Resolve (acknowledge without replay)

```bash
curl -X POST http://localhost:8080/api/v1/deadletters/orders_sync/resolve \
  -H 'Content-Type: application/json' \
  -d '{"ids": ["dl-001", "dl-002"]}'
```

---

## System endpoints

### Health check

```bash
curl http://localhost:8080/health
# → "ok"
```

### Prometheus metrics

```bash
curl http://localhost:8080/metrics
```

See [Monitoring](../operations/monitoring.md) for metric names and alerting.

### WebSocket — live shuttle events

```
ws://localhost:8080/ws/shuttles
```

Streams real-time shuttle events (state changes, commits, errors) as JSON messages.

### Embedded documentation

```
http://localhost:8080/docs/
```

Built-in mdbook documentation served from the binary.
