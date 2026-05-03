# Connections

Connections define how DataShuttle reaches a source system. Create a connection before creating shuttles that use it.

## CREATE CONNECTION

```sql
CREATE CONNECTION <name>
  TYPE <type>
  PROPERTIES (
    <key> = '<value>',
    ...
  );
```

`IF NOT EXISTS` is supported:

```sql
CREATE CONNECTION IF NOT EXISTS pg_prod TYPE POSTGRES PROPERTIES (...);
```

## DROP CONNECTION

```sql
DROP CONNECTION <name>;
```

Fails with `409 Conflict` if any shuttle is currently using the connection. Drop or reassign dependent shuttles first.

---

## PostgreSQL

```sql
CREATE CONNECTION pg_prod
  TYPE POSTGRES
  PROPERTIES (
    host = 'db.internal',
    port = '5432',               -- default: 5432
    database = 'production',
    username = 'datashuttle',
    password = SECRET 'vault://secrets/pg_pass',
    replication_slot = 'datashuttle_crm',  -- auto-generated if omitted
    publication = 'datashuttle_pub'         -- auto-generated if omitted
  );
```

Requires PostgreSQL 12+ with `wal_level = logical`. See [PostgreSQL connector](../connectors/postgresql.md).

## MySQL

```sql
CREATE CONNECTION mysql_prod
  TYPE MYSQL
  PROPERTIES (
    host = 'mysql.internal',
    port = '3306',               -- default: 3306
    database = 'analytics',
    username = 'datashuttle',
    password = 'secret'
  );
```

Requires `binlog_format = ROW` and GTID mode enabled.

## MongoDB

```sql
CREATE CONNECTION events_db
  TYPE MONGODB
  PROPERTIES (
    uri = 'mongodb://user:pass@mongo1:27017,mongo2:27017/events?replicaSet=rs0'
  );
```

Requires a replica set. Standalone `mongod` does not support change streams.

## S3 / Object Storage

```sql
CREATE CONNECTION s3_lake
  TYPE S3
  PROPERTIES (
    endpoint = 'http://localhost:9000',  -- omit for AWS S3
    region = 'us-east-1',
    access_key = 'minioadmin',
    secret_key = SECRET 'vault://secrets/s3_key',
    path_style = 'true'                  -- required for MinIO; default: false
  );
```

## ClickHouse

```sql
CREATE CONNECTION ch_prod
  TYPE CLICKHOUSE
  PROPERTIES (
    host = 'clickhouse.internal',
    port = '8123',              -- HTTP port, default: 8123
    database = 'analytics',
    username = 'default',       -- default: default
    password = SECRET 'vault://secrets/ch_pass',
    protocol = 'http',          -- http (default) or native
    cluster = 'prod_cluster',   -- for distributed (MPP) reads
    local_table_suffix = '_local',  -- suffix for shard-local tables, default: _local
    watermark_column = 'updated_at', -- column for incremental reads
    tls = 'false'
  );
```

Supports incremental reads via `watermark_column`. For distributed tables in a ClickHouse cluster, set `cluster` to enable MPP parallel snapshot.

## Snowflake

```sql
CREATE CONNECTION sf_prod
  TYPE SNOWFLAKE
  PROPERTIES (
    account = 'myorg-myaccount',
    username = 'datashuttle',
    password = SECRET 'vault://secrets/sf_pass',
    warehouse = 'COMPUTE_WH',
    database = 'ANALYTICS',
    schema = 'PUBLIC',           -- default: PUBLIC
    role = 'SYSADMIN'            -- default: SYSADMIN
  );
```

## Google BigQuery

```sql
CREATE CONNECTION bq_prod
  TYPE BIGQUERY
  PROPERTIES (
    project_id = 'my-gcp-project',
    dataset = 'analytics',
    credentials_json = SECRET 'vault://secrets/bq_sa_key',  -- inline JSON
    -- credentials_file = '/etc/sa/key.json',               -- or file path
    location = 'US',              -- default: US
    watermark_column = 'updated_at'
  );
```

## Databricks / Delta Lake

```sql
CREATE CONNECTION dbx_prod
  TYPE DATABRICKS
  PROPERTIES (
    workspace_url = 'https://adb-123456.azuredatabricks.net',
    token = SECRET 'vault://secrets/dbx_token',
    catalog = 'main',
    schema = 'default',           -- default: default
    warehouse_id = 'abc123def456'
  );
```

Supports Delta Change Data Feed for continuous sync.

## Oracle Database

```sql
CREATE CONNECTION oracle_prod
  TYPE ORACLE
  PROPERTIES (
    host = 'oracle.internal',
    port = '8080',               -- ORDS HTTP port, default: 8080
    service_name = 'ORCLPDB1',
    username = 'datashuttle',
    password = SECRET 'vault://secrets/oracle_pass',
    pdb_name = 'ORCLPDB1',       -- optional, for CDB/PDB setups
    logminer_start_scn = '',     -- starting SCN for CDC (default: current)
    tls = 'false'
  );
```

Uses Oracle ORDS for HTTP-based connectivity. Requires SELECT and LogMiner privileges.

## SQL Server

```sql
CREATE CONNECTION mssql_prod
  TYPE SQLSERVER
  PROPERTIES (
    host = 'sqlserver.internal',
    port = '1433',               -- default: 1433
    database = 'Northwind',
    username = 'datashuttle',
    password = SECRET 'vault://secrets/mssql_pass',
    instance_name = '',          -- named instance, alternative to port
    cdc_mode = 'cdc',            -- cdc (default) or change_tracking
    encrypt = 'required',        -- required / optional / not_supported
    trust_server_certificate = 'false',
    application_intent = 'read_write'  -- read_write or read_only (AG replicas)
  );
```

## CockroachDB

```sql
CREATE CONNECTION crdb_prod
  TYPE COCKROACHDB
  PROPERTIES (
    host = 'crdb.internal',
    port = '26257',              -- default: 26257
    database = 'defaultdb',
    username = 'root',
    password = SECRET 'vault://secrets/crdb_pass',
    sslmode = 'verify-full',     -- default: verify-full
    cluster_id = '',             -- for CockroachDB Cloud
    changefeed_format = 'json'   -- json (default) or avro
  );
```

Supports sub-second latency via CockroachDB changefeeds pushed as webhook events.

## Greenplum

```sql
CREATE CONNECTION gp_prod
  TYPE GREENPLUM
  PROPERTIES (
    host = 'gp-coordinator.internal',
    port = '5432',               -- default: 5432
    database = 'dw',
    username = 'gpadmin',
    password = SECRET 'vault://secrets/gp_pass',
    publication = 'datashuttle_pub'
  );
```

Wire-compatible with PostgreSQL. Supports MPP parallel snapshot reading directly from Greenplum segments.

## Vertica

```sql
CREATE CONNECTION vertica_prod
  TYPE VERTICA
  PROPERTIES (
    host = 'vertica-vip.internal',
    port = '5433',               -- default: 5433
    database = 'analytics',
    username = 'datashuttle',
    password = SECRET 'vault://secrets/vertica_pass',
    schema = 'public',           -- default: public
    tls_mode = 'verify-full',    -- disable / require / verify-ca / verify-full
    backup_server_node = 'node2,node3',  -- failover hosts
    watermark_column = 'updated_at'
  );
```

## StarRocks

```sql
CREATE CONNECTION sr_prod
  TYPE STARROCKS
  PROPERTIES (
    fe_host = 'sr-fe.internal',
    fe_query_port = '9030',      -- MySQL protocol port, default: 9030
    fe_http_port = '8030',       -- HTTP port, default: 8030
    database = 'analytics',
    username = 'root',
    password = SECRET 'vault://secrets/sr_pass',
    auth_type = 'password',      -- password or ldap
    be_hosts = 'be1,be2,be3',    -- direct BE hosts for parallel reads
    watermark_column = 'updated_at'
  );
```

## Apache Cassandra

```sql
CREATE CONNECTION cassandra_prod
  TYPE CASSANDRA
  PROPERTIES (
    hosts = 'node1,node2,node3',  -- comma-separated contact points
    port = '9042',                -- CQL native port, default: 9042
    keyspace = 'my_keyspace',
    username = 'cassandra',
    password = SECRET 'vault://secrets/cassandra_pass',
    datacenter = 'datacenter1',   -- for DCAwareRoundRobin policy
    tls = 'false'
  );
```

## Amazon DynamoDB

```sql
CREATE CONNECTION dynamo_prod
  TYPE DYNAMODB
  PROPERTIES (
    region = 'us-east-1',
    access_key_id = 'AKIAIOSFODNN7EXAMPLE',
    secret_access_key = SECRET 'vault://secrets/aws_secret',
    table_name = 'my-table',     -- optional; omit to discover all tables
    endpoint_url = ''            -- custom endpoint, e.g. http://localhost:8000 for LocalStack
  );
```

## Amazon Kinesis

```sql
CREATE CONNECTION kinesis_prod
  TYPE KINESIS
  PROPERTIES (
    region = 'us-east-1',
    stream_name = 'events-stream',
    access_key_id = 'AKIAIOSFODNN7EXAMPLE',
    secret_access_key = SECRET 'vault://secrets/aws_secret',
    endpoint_url = '',           -- optional, for LocalStack
    consumer_name = '',          -- enhanced fan-out consumer (optional)
    start_position = 'LATEST'   -- TRIM_HORIZON | LATEST | AT_TIMESTAMP
  );
```

## Google BigQuery (Storage Read API)

Same as `BIGQUERY` above — the connection type covers both batch export and Storage Read API.

## Hadoop / HDFS

```sql
CREATE CONNECTION hdfs_prod
  TYPE HADOOP
  PROPERTIES (
    namenode_url = 'http://namenode:9870',
    username = 'hdfs',
    -- Additional Hadoop XML properties passed through
    'dfs.client.use.datanode.hostname' = 'true'
  );
```

## REST API

```sql
CREATE CONNECTION shopify_api
  TYPE REST_API
  PROPERTIES (
    base_url = 'https://mystore.myshopify.com/admin/api/2024-01',
    auth_type = 'bearer',
    token = SECRET 'vault://secrets/shopify_token',
    -- pagination_mode = 'cursor' | 'offset' | 'keyset' | 'link_header' | 'none'
    pagination_mode = 'cursor',
    -- rate_limit_requests_per_second = '2'
    rate_limit_requests_per_second = '2'
  );
```

---

## Connection status

```bash
curl http://localhost:8080/api/v1/connections/<name>/status
```

Returns `is_reachable`, `dependent_shuttles`, and `error_message`.

## Discover tables

```bash
curl http://localhost:8080/api/v1/connections/<name>/tables
```

Lists all tables available in the source. Useful before writing a `CREATE SHUTTLE` statement.
