# WebSocket Events

Connect to the WebSocket endpoint for real-time pipeline events. Useful for dashboards, alerting integrations, and custom monitoring.

## Endpoint

```
ws://<host>:8080/ws/pipelines
```

## Event format

Events are JSON objects:

```json
{
  "event_type": "pipeline.commit",
  "pipeline": "orders_sync",
  "detail": {
    "rows": 1000,
    "snapshot_id": 12345
  },
  "timestamp": "2026-03-27T18:00:00Z"
}
```

## Event types

| Event | Trigger | Detail fields |
|-------|---------|---------------|
| `pipeline.created` | Pipeline created | `mode`, `tables` |
| `pipeline.paused` | Pipeline paused (user or circuit breaker) | `reason` |
| `pipeline.resumed` | Pipeline resumed | — |
| `pipeline.dropped` | Pipeline dropped | — |
| `pipeline.commit` | Successful Iceberg commit | `rows`, `snapshot_id`, `files_written` |
| `pipeline.error` | Pipeline error (auto-paused) | `error_message`, `error_type` |
| `pipeline.schema.changed` | Source schema change detected | `changes` |

## Example: JavaScript client

```javascript
const ws = new WebSocket('ws://localhost:8080/ws/pipelines');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(`[${data.event_type}] ${data.pipeline}`, data.detail);

  if (data.event_type === 'pipeline.error') {
    // Trigger alert
    alert(`Pipeline ${data.pipeline} failed: ${data.detail.error_message}`);
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};
```

## Example: Python client

```python
import json
import websocket

def on_message(ws, message):
    event = json.loads(message)
    print(f"[{event['event_type']}] {event['pipeline']}")

ws = websocket.WebSocketApp(
    "ws://localhost:8080/ws/pipelines",
    on_message=on_message
)
ws.run_forever()
```

## Notes

- The WebSocket connection receives events from **all pipelines** on the cluster
- Events are broadcast from the node that owns the pipeline — connect to any node
- Reconnect on disconnect; there is no event replay (use the REST API for historical data)
