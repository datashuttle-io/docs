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

## Pipelines

### List pipelines

```bash
curl http://localhost:8080/api/v1/pipelines

# Filter by status
curl http://localhost:8080/api/v1/pipelines?status=running
```

**Response** `200 OK`:

```json
[
  {
    "name": "orders_sync",
    "connection": "crm_prod",
    "target": "warehouse.raw",
    "schedule": "continuous",
    "mode": "CDC",
    "state": "running",
    "owner": "node-1",
    "table_count": 3,
    "created_at": "2026-03-27T10:00:00Z"
  }
]
```

### Create pipeline

```bash
curl -X POST http://localhost:8080/api/v1/pipelines \
  -H 'Content-Type: application/json' \
  -d '{"sql": "CREATE PIPELINE orders_sync SOURCE crm_prod TABLE orders TARGET warehouse.raw"}'
```

**Response** `201 Created` — full pipeline record.

### Get pipeline details

```bash
curl http://localhost:8080/api/v1/pipelines/orders_sync
```

**Response** `200 OK` — full pipeline record with options, tables, schedule, and definition SQL.

### Drop pipeline

```bash
curl -X DELETE http://localhost:8080/api/v1/pipelines/orders_sync
```

**Response** `204 No Content`

### Pause / Resume

```bash
curl -X POST http://localhost:8080/api/v1/pipelines/orders_sync/pause
curl -X POST http://localhost:8080/api/v1/pipelines/orders_sync/resume
```

**Response** `200 OK` — updated pipeline record.

### Pipeline status

```bash
curl http://localhost:8080/api/v1/pipelines/orders_sync/status
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

### Pipeline history

```bash
curl http://localhost:8080/api/v1/pipelines/orders_sync/history?limit=10
```

### Pipeline lineage

Returns source tables, destination Iceberg tables, and per-table edges for a pipeline.

```bash
curl http://localhost:8080/api/v1/pipelines/orders_sync/lineage
```

**Response** `200 OK`:

```json
{
  "pipeline": "orders_sync",
  "connection": "crm_prod",
  "mode": "CDC",
  "state": "running",
  "source_tables": [
    {
      "schema": "public",
      "table": "orders",
      "primary_key": ["id"],
      "mode": "CDC"
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
  "dependent_pipelines": ["orders_sync", "users_cdc"],
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

Aggregate metrics across all pipelines.

```bash
curl http://localhost:8080/api/v1/monitoring/stats
```

**Response** `200 OK`:

```json
{
  "total_pipelines": 12,
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
  "pipeline_metrics": [
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
  "node_count": 3
}
```

---

## SQL Execution

### Execute SQL

General-purpose SQL execution endpoint. Supports all DDL statements (`CREATE PIPELINE`, `CREATE CONNECTION`, `SHOW PIPELINES`, etc.).

```bash
curl -X POST http://localhost:8080/api/v1/sql \
  -H 'Content-Type: application/json' \
  -d '{"sql": "SHOW PIPELINES"}'
```

---

## Settings

### Get server settings

```bash
curl http://localhost:8080/api/v1/settings
```

Returns catalog, storage, auth, and pipeline default configuration.

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

# Pipeline defaults
curl -X PUT http://localhost:8080/api/v1/settings/pipeline_defaults \
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

### WebSocket — live pipeline events

```
ws://localhost:8080/ws/pipelines
```

Streams real-time pipeline events (state changes, commits, errors) as JSON messages.

### Embedded documentation

```
http://localhost:8080/docs/
```

Built-in mdbook documentation served from the binary.
