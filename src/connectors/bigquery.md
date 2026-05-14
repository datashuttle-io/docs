# Google BigQuery Connector

> **Tier-2 connector.** This connector lives in the
> [`datashuttle-connectors-extra`](https://github.com/evgenyestepanov-star/datashuttle-connectors-extra)
> repo and is **not** compiled into the default OSS build. To run it
> against a running OSS install, follow the
> [External Connectors operator runbook](../operations/external-connectors.md)
> — package the sidecar binary, register it in `connectors.json`, and
> the runtime registry will pick the connector type up at startup.

Sync BigQuery tables to Iceberg using watermark-based incremental reads or full export. Supports MPP parallel reads via the BigQuery Storage Read API.

## Sync model

BigQuery does not provide a native change stream. DataShuttle uses **watermark-based incremental reads**: on each scheduled run it queries only rows where `watermark_column > last_checkpoint_value`. The checkpoint is persisted across runs.

For `SCHEDULE continuous`, the shuttle polls at the minimum interval. Use `SCHEDULE EVERY '<interval>'` for explicit control and to manage BigQuery query costs.

## Prerequisites

- GCP project with the BigQuery API enabled
- Service account JSON key with the `bigquery.dataViewer` role (or equivalent)
- A monotonically increasing column for incremental reads (e.g. `updated_at TIMESTAMP`, `id INT64`)

## CREATE CONNECTION

```sql
CREATE CONNECTION bq_prod
  TYPE BIGQUERY
  PROPERTIES (
    project_id = 'my-gcp-project',
    dataset = 'analytics',
    credentials_json = SECRET 'vault://secrets/bq_sa_key',
    location = 'US',
    watermark_column = 'updated_at'
  );
```

Using a credentials file on disk:

```sql
CREATE CONNECTION bq_prod
  TYPE BIGQUERY
  PROPERTIES (
    project_id = 'my-gcp-project',
    dataset = 'analytics',
    credentials_file = '/etc/sa/key.json',
    location = 'EU',
    watermark_column = 'updated_at'
  );
```

### Connection properties

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `project_id` | Yes | — | GCP project ID |
| `dataset` | Yes | — | BigQuery dataset |
| `credentials_json` | Yes* | — | Service account JSON key (inline string) |
| `credentials_file` | Yes* | — | Path to service account JSON key file |
| `location` | No | `US` | Dataset location |
| `watermark_column` | No | — | Column for incremental reads |

\* Provide exactly one of `credentials_json` or `credentials_file`.

## CREATE SHUTTLE

```sql
-- Incremental sync (recommended — minimizes BigQuery costs)
CREATE SHUTTLE bq_events
  SOURCE bq_prod TABLE events
  TARGET warehouse.raw
  SCHEDULE EVERY '15 minutes'
  WITH (watermark_column = 'event_timestamp');

-- Full snapshot, periodic
CREATE SHUTTLE bq_daily_dim
  SOURCE bq_prod TABLE dim_product
  TARGET warehouse.raw
  SCHEDULE EVERY '24 hours';
```

## Type mapping

| BigQuery | Arrow | Iceberg |
|----------|-------|---------|
| `BOOL` | Boolean | `boolean` |
| `INT64` / `INTEGER` | Int64 | `long` |
| `FLOAT64` / `FLOAT` | Float64 | `double` |
| `NUMERIC(p,s)` | Decimal128(p,s) | `decimal(p,s)` |
| `BIGNUMERIC(p,s)` | Decimal128(p,s) | `decimal(p,s)` |
| `STRING` | Utf8 | `string` |
| `BYTES` | Binary | `binary` |
| `DATE` | Date32 | `date` |
| `TIME` | Time64(μs) | `time` |
| `DATETIME` | Timestamp(μs, None) | `timestamp` |
| `TIMESTAMP` | Timestamp(μs, UTC) | `timestamptz` |
| `JSON` | Utf8 | `string` |
| `ARRAY<T>` | Utf8 | `string` (JSON) |
| `STRUCT<...>` / `RECORD` | Utf8 | `string` (JSON) |
| `GEOGRAPHY` | Utf8 | `string` (GeoJSON) |

## Limitations

- **No native CDC** — deletes in BigQuery are not captured. If the source table uses logical deletes (`is_deleted` flag, `deleted_at` timestamp), filter downstream.
- Nested `ARRAY` and `STRUCT` / `RECORD` types are serialized as JSON strings.
- **BigQuery query costs apply** on every sync run. Use `SCHEDULE EVERY` with a reasonable interval and always set `watermark_column` to minimize bytes scanned.
- `BIGNUMERIC` precision up to 77 digits is truncated to Decimal128 (38 digits) — precision loss may occur for very large values.
