# Amazon Kinesis Connector

Stream Amazon Kinesis Data Streams records to Iceberg continuously with sub-second latency.

## Sync model

DataShuttle consumes Kinesis shards as a native consumer (one reader per shard). Records are written to Iceberg as they arrive, committed at the configured `commit_interval`.

For streams with many shards, DataShuttle cluster nodes split shard ownership (MPP parallel read) — each node reads a subset of shards.

Two consumption modes are supported:
- **Standard consumer** (default) — shared 5 reads/sec per shard limit
- **Enhanced fan-out** (set `consumer_name`) — dedicated 2 MB/sec per shard, no shared throttling

## Prerequisites

- IAM permissions:
  ```json
  {
    "Effect": "Allow",
    "Action": [
      "kinesis:GetRecords",
      "kinesis:GetShardIterator",
      "kinesis:DescribeStream",
      "kinesis:DescribeStreamSummary",
      "kinesis:ListShards",
      "kinesis:SubscribeToShard"
    ],
    "Resource": "arn:aws:kinesis:<region>:<account>:stream/<stream-name>"
  }
  ```

## CREATE CONNECTION

```sql
CREATE CONNECTION kinesis_events
  TYPE KINESIS
  PROPERTIES (
    region = 'us-east-1',
    stream_name = 'user-events',
    access_key_id = 'AKIAIOSFODNN7EXAMPLE',
    secret_access_key = SECRET 'vault://secrets/aws_secret',
    start_position = 'LATEST'
  );
```

For enhanced fan-out:

```sql
CREATE CONNECTION kinesis_fanout
  TYPE KINESIS
  PROPERTIES (
    region = 'us-east-1',
    stream_name = 'user-events',
    access_key_id = 'AKIAIOSFODNN7EXAMPLE',
    secret_access_key = SECRET 'vault://secrets/aws_secret',
    consumer_name = 'datashuttle-consumer',
    start_position = 'TRIM_HORIZON'
  );
```

For LocalStack:

```sql
CREATE CONNECTION kinesis_local
  TYPE KINESIS
  PROPERTIES (
    region = 'us-east-1',
    stream_name = 'test-stream',
    access_key_id = 'test',
    secret_access_key = 'test',
    endpoint_url = 'http://localhost:4566'
  );
```

### Connection properties

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `region` | Yes | — | AWS region |
| `stream_name` | Yes | — | Kinesis stream name |
| `access_key_id` | No | — | AWS access key (uses instance role / env if omitted) |
| `secret_access_key` | No | — | AWS secret access key |
| `endpoint_url` | No | — | Custom endpoint (LocalStack, etc.) |
| `consumer_name` | No | — | Enhanced fan-out consumer name |
| `start_position` | No | `LATEST` | `TRIM_HORIZON` / `LATEST` / `AT_TIMESTAMP` |

## CREATE PIPELINE

```sql
CREATE PIPELINE kinesis_user_events
  SOURCE kinesis_events TABLE events
  TARGET warehouse.raw
  SCHEDULE continuous
  WITH (commit_interval = '10 seconds');
```

## Output schema

Each record lands as a row with the following fixed schema:

| Column | Iceberg type | Description |
|--------|-------------|-------------|
| `sequence_number` | `string` | Record sequence number within the shard |
| `partition_key` | `string` | Partition key used for shard routing |
| `data` | `string` | Record body, decoded from base64 |
| `arrival_timestamp` | `timestamptz` | Approximate arrival time at Kinesis |
| `shard_id` | `string` | Source shard ID |

Use transforms to parse `data` into typed columns. Example with a JSON payload:

```sql
CREATE PIPELINE kinesis_events_parsed
  SOURCE kinesis_events TABLE events
  TARGET warehouse.raw
  SCHEDULE continuous
  WITH (
    type_overrides = ('data' AS VARIANT)
  );
```

## Checkpoint and recovery

DataShuttle checkpoints the sequence number per shard after each successful Iceberg commit. On restart, reading resumes from the last committed sequence number per shard. No records are skipped or duplicated across restarts (exactly-once delivery is guaranteed at the pipeline level).

## Limitations

- `start_position = 'AT_TIMESTAMP'` requires specifying the timestamp via the `start_timestamp` pipeline option (ISO-8601 string). Not yet exposed in the `WITH` clause — contact support for workarounds.
- Kinesis streams have a 7-day data retention limit. Pausing a pipeline beyond the retention window causes the iterator to expire; a full resync from the start of the available window (`TRIM_HORIZON`) is triggered automatically.
- Record payloads are treated as opaque strings (UTF-8). Avro/Protobuf deserialization with Schema Registry is planned.
