# Connector Guides

## PostgreSQL

### Prerequisites
- PostgreSQL 12+ with `wal_level = logical`
- A dedicated replication user with `REPLICATION` privilege
- A publication for the tables you want to replicate

### Setup

```sql
-- On the source PostgreSQL:
CREATE USER datashuttle_cdc WITH REPLICATION PASSWORD 'secret';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO datashuttle_cdc;
CREATE PUBLICATION datashuttle_pub FOR ALL TABLES;
```

### Pipeline Configuration

```sql
CREATE CONNECTION pg_prod
  TYPE POSTGRES
  PROPERTIES (
    host = 'db.internal',
    port = 5432,
    database = 'production',
    username = 'datashuttle_cdc',
    password = SECRET 'vault://secrets/pg_pass',
    replication_slot = 'datashuttle_slot',
    publication = 'datashuttle_pub'
  );

CREATE PIPELINE orders_sync
  SOURCE pg_prod TABLE orders
  TARGET warehouse.raw
  WITH (mode = 'SNAPSHOT_THEN_CDC');
```

### Type Mapping

| PostgreSQL | Arrow | Iceberg V3 |
|-----------|-------|-----------|
| integer | Int32 | int |
| bigint | Int64 | long |
| text/varchar | Utf8 | string |
| boolean | Boolean | boolean |
| timestamp | Timestamp(μs) | timestamptz |
| jsonb | Utf8 | string (or VARIANT in V3) |
| uuid | Utf8 | string |
| numeric | Decimal128 | decimal |

---

## MySQL

### Prerequisites
- MySQL 8.0+ with `binlog_format = ROW` and GTID enabled
- A user with `REPLICATION SLAVE` privilege

### Setup

```sql
CREATE USER 'datashuttle'@'%' IDENTIFIED BY 'secret';
GRANT SELECT, REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'datashuttle'@'%';
```

### Pipeline Configuration

```sql
CREATE CONNECTION mysql_prod
  TYPE MYSQL
  PROPERTIES (
    host = 'mysql.internal',
    port = 3306,
    database = 'production',
    username = 'datashuttle',
    password = 'secret'
  );
```

---

## MongoDB

### Prerequisites
- MongoDB 4.0+ replica set (change streams require replica set)

### Pipeline Configuration

```sql
CREATE CONNECTION mongo_prod
  TYPE MONGODB
  PROPERTIES (
    uri = 'mongodb://user:pass@mongo1:27017,mongo2:27017/mydb?replicaSet=rs0'
  );
```

---

## S3 / File Sources

### Pipeline Configuration

```sql
CREATE CONNECTION data_lake
  TYPE S3
  PROPERTIES (
    endpoint = 'https://s3.amazonaws.com',
    region = 'us-east-1',
    access_key = SECRET 'vault://secrets/s3_key',
    secret_key = SECRET 'vault://secrets/s3_secret'
  );

CREATE PIPELINE raw_events
  SOURCE data_lake PATH 's3://bucket/events/'
  TARGET warehouse.raw
  WITH (
    mode = 'APPEND',
    file_pattern = '*.parquet',
    commit_interval = '5 minutes'
  );
```
