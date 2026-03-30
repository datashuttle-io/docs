# S3 / File Sources

Ingest Parquet, CSV, and JSON files from S3-compatible object storage into Iceberg.

## Prerequisites

- An S3-compatible storage endpoint (AWS S3, MinIO, GCS with S3 compatibility, etc.)
- Credentials with read access to the source bucket/prefix

## CREATE CONNECTION

```sql
CREATE CONNECTION data_lake
  TYPE S3
  PROPERTIES (
    endpoint = 'https://s3.amazonaws.com',
    region = 'us-east-1',
    access_key = SECRET 'vault://secrets/s3_key',
    secret_key = SECRET 'vault://secrets/s3_secret'
  );
```

For MinIO or other S3-compatible services:

```sql
CREATE CONNECTION minio_local
  TYPE S3
  PROPERTIES (
    endpoint = 'http://localhost:9000',
    region = 'us-east-1',
    access_key = 'minioadmin',
    secret_key = 'minioadmin',
    path_style = 'true'
  );
```

## CREATE PIPELINE

```sql
-- Parquet files, periodic scan every 5 minutes
CREATE PIPELINE raw_events
  SOURCE data_lake PATH 's3://bucket/events/'
  TARGET warehouse.raw
  SCHEDULE EVERY '5 minutes'
  WITH (file_pattern = '*.parquet');

-- CSV files with options
CREATE PIPELINE csv_import
  SOURCE data_lake PATH 's3://bucket/csv-data/'
  TARGET warehouse.staging
  SCHEDULE EVERY '10 minutes'
  WITH (
    file_pattern = '*.csv',
    csv_header = 'true',
    csv_delimiter = ','
  );

-- JSON files (newline-delimited)
CREATE PIPELINE json_events
  SOURCE data_lake PATH 's3://bucket/json-events/'
  TARGET warehouse.raw
  SCHEDULE EVERY '5 minutes'
  WITH (file_pattern = '*.json');
```

## Sync behavior

- **Schedule**: Periodic scan of the source path for new files at the configured interval.
- **File tracking**: Each ingested file is recorded by path + ETag. Files are never re-ingested unless you explicitly reload.
- **Schema inference**: Schema is inferred from the first file. Subsequent files with additional columns trigger schema evolution (in `compatible` mode).
- **Ordering**: Files are processed in lexicographic order by key. Use date-partitioned prefixes (e.g., `s3://bucket/events/2026/03/28/`) for natural ordering.

## Supported formats

| Format | Extension | Notes |
|--------|-----------|-------|
| Apache Parquet | `.parquet` | Native. Schema inferred from file metadata. |
| CSV | `.csv` | Configurable delimiter, header, quoting |
| JSON (NDJSON) | `.json`, `.jsonl` | Newline-delimited JSON. One object per line. |

## Type mapping (CSV / JSON)

CSV and JSON values are inferred:

| Inferred type | Iceberg V3 |
|---------------|-----------|
| Integer | `long` |
| Decimal | `double` |
| Boolean (`true`/`false`) | `boolean` |
| ISO 8601 datetime | `timestamptz` |
| Everything else | `string` |

Parquet files retain their native schema — no inference needed.

## Limitations

- **Append-only**: File sources ingest new files only. Changes to existing files are not detected.
- **No delete support**: Deletion vectors are not generated for file ingestion.
- **Large files**: Files larger than 1 GB are ingested as a single unit. Consider pre-splitting very large files.
- **Glob patterns**: Only simple wildcards (`*`) are supported. Complex glob patterns (e.g., `{2025,2026}/**`) are not.
