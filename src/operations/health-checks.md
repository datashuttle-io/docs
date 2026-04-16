# Health Checks

DataShuttle exposes four HTTP endpoints for health monitoring
(introduced in #573). The surface is split so Kubernetes — or any
other orchestrator — can distinguish "the process is alive" from "the
process is ready to serve traffic" and get a structured per-dependency
report for dashboards without paying for an on-demand fan-out probe.

All four endpoints bypass authentication so probes never need
credentials.

## Endpoints

| Path                    | Purpose                                           | Typical use                  |
|-------------------------|---------------------------------------------------|------------------------------|
| `GET /health/live`      | Liveness — is the process alive?                  | K8s `livenessProbe`          |
| `GET /health/ready`     | Readiness — is this pod ready to serve?           | K8s `readinessProbe`         |
| `GET /health/dependencies` | Verbose per-dependency status for ops          | Dashboards / external alerts |
| `GET /health`           | Legacy alias — returns the same body as `/live`   | Backward compat only         |

### `GET /health/live`

Cheap. No database calls, no object-storage HEAD, no Iceberg catalog
round-trip. Returns immediately (<10ms on healthy hardware) so a slow
or wedged dependency can never cause Kubernetes to kill the pod.

```json
{
  "status": "ok",
  "node_id": "datashuttle-0",
  "uptime_seconds": 3641
}
```

**Status codes:** always `200 OK` while the HTTP server is up.

### `GET /health/ready`

Reads the cached dependency snapshot written by the background
dependency checker (default interval: 10s). Returns:

- `200 OK` when every **required** dependency is `Up` or `Degraded`.
- `503 Service Unavailable` when any required dependency is `Down` or
  still `Unknown` (never probed), with a body that lists the failing
  names so operators can see at a glance what's wrong.
- `503 Service Unavailable` while the node is draining (#220) so
  Kubernetes stops routing traffic immediately when a shutdown begins.

Example happy-path body:

```json
{ "status": "ok", "node_id": "datashuttle-0" }
```

Example failure body:

```json
{
  "status": "not_ready",
  "node_id": "datashuttle-0",
  "failing": ["iceberg_catalog"],
  "dependencies": [
    {
      "name": "iceberg_catalog",
      "required": true,
      "status": "down",
      "latency_ms": 2000,
      "last_checked_at": "2026-04-14T10:30:00Z",
      "message": "catalog unreachable: connection refused"
    },
    {
      "name": "registry",
      "required": true,
      "status": "up",
      "latency_ms": 1,
      "last_checked_at": "2026-04-14T10:30:00Z",
      "message": null
    }
  ]
}
```

### `GET /health/dependencies`

Always returns `200 OK` (if the HTTP server itself is running). The
body contains one entry per registered check plus an `overall`
rollup:

- `ok` — every required dep is `Up`.
- `degraded` — at least one required dep is `Degraded` (slow or
  partial response); nothing is `Down`.
- `down` — at least one required dep is `Down` or `Unknown`.

Optional checks (`required: false`) are listed for visibility but do
not influence `overall`.

```json
{
  "node_id": "datashuttle-0",
  "overall": "degraded",
  "dependencies": [
    {
      "name": "registry",
      "required": true,
      "status": "up",
      "latency_ms": 1,
      "last_checked_at": "2026-04-14T10:30:00Z",
      "message": null
    },
    {
      "name": "iceberg_catalog",
      "required": true,
      "status": "degraded",
      "latency_ms": 1800,
      "last_checked_at": "2026-04-14T10:30:00Z",
      "message": "slow response"
    },
    {
      "name": "stripe",
      "required": false,
      "status": "up",
      "latency_ms": 0,
      "last_checked_at": "2026-04-14T10:30:00Z",
      "message": null
    }
  ]
}
```

### `GET /health` (legacy)

Preserved as an alias that returns the same body as `/health/live`.
Existing monitors and scripts continue to work unchanged. New
integrations should point at `/health/live` or `/health/ready`
directly.

## Failure semantics

| Status      | Meaning                                                    | Affects `ready`? |
|-------------|------------------------------------------------------------|------------------|
| `up`        | Responded within timeout, no errors.                       | No (pass)        |
| `degraded`  | Responded but slow / partial. Node still serves traffic.   | No (pass)        |
| `down`      | Failed the last probe (error or timeout).                  | **Yes** if required |
| `unknown`   | Never probed yet — conservative default.                   | **Yes** if required |

- **Required** deps (`registry`, `iceberg_catalog` when configured)
  drive readiness. Going `Down` or `Unknown` returns `503` from
  `/health/ready`.
- **Optional** deps (`stripe`, `smtp`) appear in
  `/health/dependencies` but never flip readiness. They're
  informational — nothing on the request path blocks on them.

## Registering custom checks

Custom dependency checks plug into the same `DependencyRegistry` used
by the built-ins. Implement the `DependencyCheck` trait and register
the check against `AppState.dependencies`:

```rust
use std::sync::Arc;
use async_trait::async_trait;
use datashuttle_api::health::{CheckResult, DependencyCheck};

pub struct ClickHouseCheck {
    client: reqwest::Client,
    url: String,
}

#[async_trait]
impl DependencyCheck for ClickHouseCheck {
    fn name(&self) -> &str { "clickhouse" }
    fn required(&self) -> bool { false }

    async fn check(&self) -> CheckResult {
        match self.client.get(&self.url).send().await {
            Ok(r) if r.status().is_success() => CheckResult::up(),
            Ok(r) => CheckResult::down(format!("HTTP {}", r.status())),
            Err(e) => CheckResult::down(format!("unreachable: {e}")),
        }
    }
}

// At AppState construction time:
state
    .dependencies
    .register(Arc::new(ClickHouseCheck {
        client: reqwest::Client::new(),
        url: "http://clickhouse:8123/ping".into(),
    }))
    .await;
```

The check will be polled automatically every 10 seconds by the
existing background sweep.

## Kubernetes probe example

The Helm chart (attached as `datashuttle-chart.tgz` to every
[GitHub Release](https://github.com/datashuttle-ai/datashuttle/releases))
configures all three probes out of the box:

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: api
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health/ready
    port: api
  initialDelaySeconds: 5
  periodSeconds: 5
  timeoutSeconds: 5
  failureThreshold: 2

startupProbe:
  httpGet:
    path: /health/live
    port: api
  initialDelaySeconds: 0
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 30
```

The startup probe gives slow boots up to 5 minutes
(`periodSeconds * failureThreshold`) before liveness kicks in —
useful for cold SQLite migrations on large registries. Override any
of the three via `values.yaml`:

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: api
  periodSeconds: 20
```
