# Amazon DynamoDB Connector

Continuously sync DynamoDB tables to Iceberg using DynamoDB Streams for CDC, or full table scan.

## Sync model

DynamoDB Streams capture all item-level changes (insert, update, delete). DataShuttle tails the stream shards for continuous sync with seconds latency.

For tables without Streams enabled, DataShuttle performs full table scans on each scheduled run.

## Prerequisites

- DynamoDB Streams enabled on target tables (set `StreamViewType = NEW_AND_OLD_IMAGES`)
- IAM permissions:
  ```json
  {
    "Effect": "Allow",
    "Action": [
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
      "dynamodb:DescribeStream",
      "dynamodb:ListStreams",
      "dynamodb:Scan",
      "dynamodb:DescribeTable"
    ],
    "Resource": "*"
  }
  ```

Enable Streams via CLI:

```bash
aws dynamodb update-table \
  --table-name orders \
  --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES
```

## CREATE CONNECTION

```sql
CREATE CONNECTION dynamo_prod
  TYPE DYNAMODB
  PROPERTIES (
    region = 'us-east-1',
    access_key_id = 'AKIAIOSFODNN7EXAMPLE',
    secret_access_key = SECRET 'vault://secrets/aws_secret'
  );
```

For LocalStack:

```sql
CREATE CONNECTION dynamo_local
  TYPE DYNAMODB
  PROPERTIES (
    region = 'us-east-1',
    access_key_id = 'test',
    secret_access_key = 'test',
    endpoint_url = 'http://localhost:8000'
  );
```

### Connection properties

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `region` | Yes | — | AWS region (e.g. `us-east-1`) |
| `access_key_id` | No | — | AWS access key (uses instance role / env if omitted) |
| `secret_access_key` | No | — | AWS secret access key |
| `table_name` | No | — | Specific table; omit to discover all tables |
| `endpoint_url` | No | — | Custom endpoint URL (LocalStack, DynamoDB Local) |

## CREATE PIPELINE

```sql
-- Continuous CDC via DynamoDB Streams
CREATE PIPELINE dynamo_orders
  SOURCE dynamo_prod TABLE orders
  TARGET warehouse.raw
  SCHEDULE continuous;

-- Sync all tables
CREATE PIPELINE dynamo_full
  SOURCE dynamo_prod TABLE *
  TARGET warehouse.raw
  SCHEDULE EVERY '1 hour';
```

## Schema inference

DynamoDB has no fixed schema. DataShuttle infers column types from a sample of items (first 1000 items by default). The inferred schema is used for all subsequent reads.

If a new attribute appears in later items that was absent from the sample, it is added as a nullable `string` column via schema evolution.

Use `type_overrides` in the pipeline `WITH` clause to force specific columns to a concrete type:

```sql
CREATE PIPELINE dynamo_orders
  SOURCE dynamo_prod TABLE orders
  TARGET warehouse.raw
  SCHEDULE continuous
  WITH (
    type_overrides = (
      'order_total' AS DECIMAL(10,2),
      'created_at'  AS TIMESTAMPTZ
    )
  );
```

## Type mapping

DynamoDB attribute types map to Arrow/Iceberg as follows:

| DynamoDB | Arrow | Iceberg | Notes |
|----------|-------|---------|-------|
| `S` (String) | Utf8 | `string` | |
| `N` (Number) | Utf8 | `string` | Use `type_overrides` for numeric precision |
| `B` (Binary) | Binary | `binary` | |
| `BOOL` | Boolean | `boolean` | |
| `NULL` | null | null | |
| `L` (List) | Utf8 | `string` | Serialized as JSON |
| `M` (Map) | Utf8 | `string` | Serialized as JSON |
| `SS` (String Set) | Utf8 | `string` | Serialized as JSON array |
| `NS` (Number Set) | Utf8 | `string` | Serialized as JSON array |
| `BS` (Binary Set) | Utf8 | `string` | Serialized as base64 JSON array |

## Limitations

- `N` (Number) attributes are captured as strings to avoid precision loss. Use `type_overrides` to cast to `DECIMAL`, `INT`, or `BIGINT` as appropriate.
- DynamoDB Streams retention is 24 hours. If the pipeline is paused beyond 24 hours, the stream position is expired and a full resync is triggered.
- Global Secondary Indexes (GSIs) are not directly readable as separate sources — query the base table instead.
- DynamoDB charges for reading stream records. High-frequency pipelines on large tables will incur stream read costs.
