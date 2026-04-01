# REST API Connector

Ingest data from any HTTP/REST API into Iceberg tables with configurable
pagination, authentication, and schema inference.

## Overview

The REST API connector enables polling-based ingestion from any HTTP API
that returns JSON responses. Each configured endpoint becomes a virtual
table that can be synced on a schedule or continuously polled.

**Key features:**

- Multiple pagination modes: offset/limit, cursor, Link header, keyset
- Authentication: bearer token, basic auth, API key (header/query), OAuth2 client credentials
- Automatic schema inference from JSON responses (with manual override)
- Watermark-based incremental reads
- JMESPath transforms for response reshaping
- Token bucket rate limiter with 429/Retry-After handling
- Webhook receiver mode with HMAC-SHA256 verification

## Capabilities

| Capability | Supported | Notes |
|---|---|---|
| Full read | ✅ | Paginate through all records |
| Incremental read | ✅ | Watermark field (e.g. `updated_at`) |
| Change tracking (CDC) | ❌ | No native CDC — use watermark polling |
| Webhook (push) | ✅ | Real-time push events |
| Schema evolution | ✅ | New JSON fields auto-detected |
| Parallel read | ❌ | Sequential pagination |
| Min latency | Seconds (webhook) / Minutes (polling) | |

## CREATE CONNECTION

### Bearer token auth

```sql
CREATE CONNECTION github_api
  TYPE REST_API
  PROPERTIES (
    base_url = 'https://api.github.com',
    auth_type = 'bearer',
    auth_token = 'ghp_xxxxxxxxxxxx',
    rate_limit_rps = '5',
    endpoints = '[
      {
        "name": "repos",
        "path": "/user/repos",
        "records_path": "$",
        "pagination_mode": "link_header",
        "pagination_page_size": 100
      }
    ]'
  );
```

### API key auth

```sql
CREATE CONNECTION weather_api
  TYPE REST_API
  PROPERTIES (
    base_url = 'https://api.weather.com/v3',
    auth_type = 'api_key',
    api_key_name = 'apiKey',
    api_key_value = 'your-key-here',
    api_key_location = 'query_param',
    endpoints = '[
      {
        "name": "observations",
        "path": "/observations/current",
        "records_path": "$.observations"
      }
    ]'
  );
```

### Basic auth

```sql
CREATE CONNECTION internal_api
  TYPE REST_API
  PROPERTIES (
    base_url = 'https://internal.example.com/api/v1',
    auth_type = 'basic',
    auth_username = 'service-account',
    auth_password = 'secret',
    endpoints = '[
      {
        "name": "events",
        "path": "/events",
        "records_path": "$.data",
        "pagination_mode": "offset_limit",
        "pagination_page_size": 200,
        "watermark_field": "updated_at",
        "watermark_param": "since"
      }
    ]'
  );
```

### OAuth2 client credentials

```sql
CREATE CONNECTION salesforce_api
  TYPE REST_API
  PROPERTIES (
    base_url = 'https://myorg.salesforce.com/services/data/v58.0',
    auth_type = 'oauth2_client_credentials',
    oauth2_token_url = 'https://login.salesforce.com/services/oauth2/token',
    oauth2_client_id = 'your-client-id',
    oauth2_client_secret = 'your-client-secret',
    oauth2_scopes = 'api refresh_token',
    endpoints = '[
      {
        "name": "accounts",
        "path": "/query?q=SELECT+Id,Name+FROM+Account",
        "records_path": "$.records",
        "pagination_mode": "cursor",
        "pagination_cursor_path": "$.nextRecordsUrl"
      }
    ]'
  );
```

## Connection Properties

### Global settings

| Property | Type | Required | Secret | Description |
|---|---|---|---|---|
| `base_url` | string | yes | no | Base URL (e.g. `https://api.example.com/v1`) |
| `endpoints` | JSON array | yes | no | Endpoint configurations (see below) |
| `auth_type` | enum | yes | no | `none`, `bearer`, `basic`, `api_key`, `oauth2_client_credentials` |
| `auth_token` | string | conditional | yes | Bearer token |
| `auth_username` | string | conditional | no | Basic auth username |
| `auth_password` | string | conditional | yes | Basic auth password |
| `api_key_name` | string | conditional | no | API key header/param name |
| `api_key_value` | string | conditional | yes | API key value |
| `api_key_location` | enum | conditional | no | `header` (default) or `query_param` |
| `oauth2_token_url` | string | conditional | no | OAuth2 token endpoint |
| `oauth2_client_id` | string | conditional | no | OAuth2 client ID |
| `oauth2_client_secret` | string | conditional | yes | OAuth2 client secret |
| `oauth2_scopes` | string | no | no | Space-separated OAuth2 scopes |
| `default_headers` | JSON object | no | no | Extra headers for all requests |
| `rate_limit_rps` | float | no | no | Max requests/second (default: 10) |
| `timeout_seconds` | integer | no | no | HTTP timeout (default: 30) |
| `tls_ca_cert` | string | no | no | Custom CA certificate (PEM) |
| `webhook_enabled` | boolean | no | no | Enable webhook receiver (default: false) |
| `webhook_secret` | string | no | yes | Webhook HMAC-SHA256 secret |

### Endpoint settings

Each endpoint in the `endpoints` array defines a virtual table:

| Property | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Virtual table name |
| `path` | string | yes | URL path appended to `base_url` |
| `method` | enum | no | `GET` (default) or `POST` |
| `records_path` | string | yes | JSONPath to records array (e.g. `$.data`) |
| `pagination_mode` | enum | no | `none`, `offset_limit`, `cursor`, `link_header`, `keyset` |
| `pagination_limit_param` | string | no | Page size param name (default: `limit`) |
| `pagination_offset_param` | string | no | Offset param name (default: `offset`) |
| `pagination_cursor_param` | string | no | Cursor param name (default: `cursor`) |
| `pagination_cursor_path` | string | no | JSONPath to next cursor in response |
| `pagination_page_size` | integer | no | Records per page (default: 100) |
| `watermark_field` | string | no | Field for incremental reads |
| `watermark_param` | string | no | Query param for watermark value |
| `jmespath_transform` | string | no | JMESPath expression to transform records |
| `schema_fields` | JSON array | no | Explicit schema override |

## Pagination Modes

### offset_limit

Increments an offset parameter by `pagination_page_size` each page.
Stops when a page returns fewer records than the page size.

```json
{
  "pagination_mode": "offset_limit",
  "pagination_offset_param": "offset",
  "pagination_limit_param": "limit",
  "pagination_page_size": 100
}
```

### cursor

Extracts a cursor token from the response using `pagination_cursor_path`
and passes it as a query parameter on the next request.

```json
{
  "pagination_mode": "cursor",
  "pagination_cursor_param": "cursor",
  "pagination_cursor_path": "$.meta.next_cursor"
}
```

### link_header

Follows the `Link: <url>; rel="next"` HTTP header (GitHub-style).

```json
{
  "pagination_mode": "link_header"
}
```

### keyset

Uses the last record's sort key as the starting point for the next page.
Similar to cursor but the value comes from a response field.

```json
{
  "pagination_mode": "keyset",
  "pagination_cursor_path": "$.meta.last_id"
}
```

## Type Mapping

| JSON Type | Arrow Type | Iceberg Type | Notes |
|---|---|---|---|
| `string` | `Utf8` | `string` | Default for strings |
| `string` (ISO 8601 datetime) | `Utf8`* | `string` | Auto-detected; downstream converts |
| `string` (ISO 8601 date) | `Utf8`* | `string` | Auto-detected |
| `number` (integer) | `Int64` | `long` | |
| `number` (float) | `Float64` | `double` | |
| `boolean` | `Boolean` | `boolean` | |
| `null` | nullable | any | |
| `object` | `Utf8` (JSON) | `string` | Nested JSON serialized as string |
| `array` | `Utf8` (JSON) | `string` | Serialized as JSON string |

*Timestamps are stored as Utf8 and converted downstream by the Iceberg writer.

Use `schema_fields` to override the inferred schema:

```json
{
  "schema_fields": [
    {"name": "id", "data_type": "integer", "nullable": false},
    {"name": "created_at", "data_type": "timestamp", "nullable": true},
    {"name": "amount", "data_type": "float", "nullable": true}
  ]
}
```

## Incremental Reads

Use watermark fields to only fetch records changed since the last sync:

```json
{
  "watermark_field": "updated_at",
  "watermark_param": "since"
}
```

The connector passes the last-seen watermark value as a query parameter:
`GET /api/orders?since=2024-01-15T10:30:00Z`

## JMESPath Transforms

Reshape API responses before ingestion using [JMESPath](https://jmespath.org/) expressions:

```json
{
  "jmespath_transform": "user"
}
```

Given a response record `{"user": {"name": "Alice"}, "meta": {"ts": 123}}`,
the transform extracts just `{"name": "Alice"}`.

## Webhook Mode

Enable push-based ingestion by setting `webhook_enabled = true` and
providing a `webhook_secret` for HMAC-SHA256 signature verification.

DataShuttle exposes: `POST /webhooks/{connector_id}/{table_name}`

The webhook payload is processed using the same `records_path` and
`jmespath_transform` configuration as polling mode.

## Rate Limiting

The connector implements a token bucket rate limiter with configurable RPS.
HTTP 429 responses trigger exponential backoff (1s → 60s max) with jitter.

If the response includes a `Retry-After` header (seconds or HTTP-date),
the connector respects that value instead of its own backoff calculation.

## Error Handling

| Error Type | Behavior |
|---|---|
| HTTP 429 | Exponential backoff with jitter, respects `Retry-After` |
| HTTP 5xx, 408 | Retry up to 5 times with exponential backoff |
| HTTP 4xx (except 429, 408) | Fail immediately (permanent error) |
| Connection timeout | Retry up to 5 times |
| Malformed JSON | Fail immediately |
| Pagination loop detected | Stop pagination with warning |

## CREATE PIPELINE

```sql
-- Sync all endpoints from a REST API connection
CREATE PIPELINE api_sync
  SOURCE github_api
  TARGET warehouse.raw;

-- Sync specific endpoint
CREATE PIPELINE repo_sync
  SOURCE github_api TABLE repos
  TARGET warehouse.github
  WITH (
    schedule = '*/15 * * * *'   -- every 15 minutes
  );
```
