# WebSocket Events

Connect to the WebSocket endpoint for real-time shuttle events. Useful for dashboards, alerting integrations, and custom monitoring.

## Endpoint

```
ws://<host>:8080/ws/shuttles
```

## Event format

Events are JSON objects:

```json
{
  "event_type": "shuttle.commit",
  "shuttle": "orders_sync",
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
| `shuttle.created` | Shuttle created | `mode`, `tables` |
| `shuttle.paused` | Shuttle paused (user or circuit breaker) | `reason` |
| `shuttle.resumed` | Shuttle resumed | — |
| `shuttle.dropped` | Shuttle dropped | — |
| `shuttle.commit` | Successful Iceberg commit | `rows`, `snapshot_id`, `files_written` |
| `shuttle.error` | Shuttle error (auto-paused) | `error_message`, `error_type` |
| `shuttle.schema.changed` | Source schema change detected | `changes` |

## Example: JavaScript client

```javascript
const ws = new WebSocket('ws://localhost:8080/ws/shuttles');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(`[${data.event_type}] ${data.shuttle}`, data.detail);

  if (data.event_type === 'shuttle.error') {
    // Trigger alert
    alert(`Shuttle ${data.shuttle} failed: ${data.detail.error_message}`);
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
    print(f"[{event['event_type']}] {event['shuttle']}")

ws = websocket.WebSocketApp(
    "ws://localhost:8080/ws/shuttles",
    on_message=on_message
)
ws.run_forever()
```

## Notes

- The WebSocket connection receives events from **all shuttles** on the cluster
- Events are broadcast from the node that owns the shuttle — connect to any node
- Reconnect on disconnect; there is no event replay (use the REST API for historical data)
