# Connections

Connections define how DataShuttle reaches a source system. Create a connection before creating pipelines that use it.

## CREATE CONNECTION

```sql
CREATE CONNECTION <name>
  TYPE <type>
  PROPERTIES (
    <key> = '<value>',
    ...
  );
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `name` | Yes | Unique identifier for this connection |
| `TYPE` | Yes | One of: `POSTGRES`, `MYSQL`, `MONGODB`, `S3` |
| `PROPERTIES` | Yes | Key-value pairs specific to the connection type |

### PostgreSQL properties

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `host` | Yes | — | Hostname or IP |
| `port` | No | `5432` | Port number |
| `database` | Yes | — | Database name |
| `username` | Yes | — | User with `REPLICATION` privilege |
| `password` | Yes | — | Password (supports `SECRET 'vault://...'`) |
| `replication_slot` | No | auto-generated | Name of the replication slot |
| `publication` | No | auto-generated | Name of the publication |

### MySQL properties

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `host` | Yes | — | Hostname or IP |
| `port` | No | `3306` | Port number |
| `database` | Yes | — | Database name |
| `username` | Yes | — | User with `REPLICATION SLAVE` privilege |
| `password` | Yes | — | Password (supports `SECRET 'vault://...'`) |

### MongoDB properties

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `uri` | Yes | — | Full MongoDB connection URI including replica set |

### S3 properties

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `endpoint` | Yes | — | S3 endpoint URL |
| `region` | Yes | — | AWS region |
| `access_key` | Yes | — | Access key ID (supports `SECRET`) |
| `secret_key` | Yes | — | Secret access key (supports `SECRET`) |
| `path_style` | No | `false` | Use path-style access (for MinIO) |

## Examples

```sql
-- PostgreSQL with Vault secret
CREATE CONNECTION crm_prod
  TYPE POSTGRES
  PROPERTIES (
    host = 'db.internal',
    port = 5432,
    database = 'production',
    username = 'datashuttle_cdc',
    password = SECRET 'vault://secrets/pg_pass',
    replication_slot = 'datashuttle_crm',
    publication = 'datashuttle_pub'
  );

-- MySQL
CREATE CONNECTION mysql_analytics
  TYPE MYSQL
  PROPERTIES (
    host = 'mysql.internal',
    port = 3306,
    database = 'analytics',
    username = 'datashuttle',
    password = 'changeme'
  );

-- MongoDB
CREATE CONNECTION events_db
  TYPE MONGODB
  PROPERTIES (
    uri = 'mongodb://user:pass@mongo1:27017,mongo2:27017/events?replicaSet=rs0'
  );

-- S3 (MinIO)
CREATE CONNECTION local_minio
  TYPE S3
  PROPERTIES (
    endpoint = 'http://localhost:9000',
    region = 'us-east-1',
    access_key = 'minioadmin',
    secret_key = 'minioadmin',
    path_style = 'true'
  );
```

## DROP CONNECTION

```sql
DROP CONNECTION <name>;
```

Fails if any pipeline is currently using this connection. Drop or reassign dependent pipelines first.

## Test a connection

Via CLI:

```bash
datashuttle sql -e "CREATE CONNECTION test_pg TYPE POSTGRES PROPERTIES (...)"
```

Via REST API:

```bash
curl http://localhost:8080/api/v1/connections/test_pg/status
```

Returns connection health and latency.
