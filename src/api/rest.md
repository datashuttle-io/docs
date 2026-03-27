# API Reference

Base URL: `http://<host>:8080`

## Authentication

Configure in `datashuttle.yaml` under `security.auth`:

| Mode | Header |
|------|--------|
| `none` | No auth required (default) |
| `basic` | `Authorization: Basic <base64(user:pass)>` |
| `api_key` | `Authorization: Bearer <key>` or `X-API-Key: <key>` |

`/health` and `/metrics` always bypass authentication.

---

## Pipelines

### List pipelines

```bash
curl http://localhost:8080/api/v1/pipelines

# Filter by status
curl http://localhost:8080/api/v1/pipelines?status=running
```

Response: `200 OK`
```json
[
  {
    "name": "orders_sync",
    "connection": "crm_prod",
    "target": "warehouse.raw",
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
  -d '{
    "sql": "CREATE PIPELINE orders_sync SOURCE crm_prod TABLE orders TARGET warehouse.raw WITH (mode = '\''CDC'\'')"
  }'
```

Response: `201 Created`

### Get pipeline details

```bash
curl http://localhost:8080/api/v1/pipelines/orders_sync
```

Response: `200 OK` — full `PipelineRecord` with options, tables, definition_sql.

### Drop pipeline

```bash
curl -X DELETE http://localhost:8080/api/v1/pipelines/orders_sync
```

Response: `204 No Content`

### Pause / Resume

```bash
curl -X POST http://localhost:8080/api/v1/pipelines/orders_sync/pause
curl -X POST http://localhost:8080/api/v1/pipelines/orders_sync/resume
```

### Pipeline status

```bash
curl http://localhost:8080/api/v1/pipelines/orders_sync/status
```

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
  -d '{
    "sql": "CREATE CONNECTION crm_prod TYPE POSTGRES PROPERTIES (host = '\''db.internal'\'', port = '\''5432'\'', database = '\''production'\'', username = '\''cdc_user'\'', password = '\''secret'\'')"
  }'
```

### Get / Delete connection

```bash
curl http://localhost:8080/api/v1/connections/crm_prod
curl -X DELETE http://localhost:8080/api/v1/connections/crm_prod
```

### Test connection

```bash
curl http://localhost:8080/api/v1/connections/crm_prod/status
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

---

## Dead Letters

### List dead letters

```bash
curl http://localhost:8080/api/v1/deadletters/orders_sync
```

### Replay / Resolve

```bash
curl -X POST http://localhost:8080/api/v1/deadletters/orders_sync/replay

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

Returns Prometheus exposition format:

```
# TYPE datashuttle_active_pipelines gauge
datashuttle_active_pipelines 42
# TYPE datashuttle_pipeline_rows_total counter
datashuttle_pipeline_rows_total{pipeline="orders_sync",table="orders"} 1523456
```

### WebSocket live events

```
ws://localhost:8080/ws/pipelines
```

Events are JSON:

```json
{
  "event_type": "pipeline.commit",
  "pipeline": "orders_sync",
  "detail": {"rows": 1000, "snapshot_id": 12345},
  "timestamp": "2026-03-27T18:00:00Z"
}
```

Event types: `pipeline.created`, `pipeline.paused`, `pipeline.resumed`, `pipeline.dropped`, `pipeline.commit`, `pipeline.error`
