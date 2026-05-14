# Oracle Database Connector

> **Tier-2 connector.** This connector lives in the
> [`datashuttle-connectors-extra`](https://github.com/evgenyestepanov-star/datashuttle-connectors-extra)
> repo and is **not** compiled into the default OSS build. To run it
> against a running OSS install, follow the
> [External Connectors operator runbook](../operations/external-connectors.md)
> — package the sidecar binary, register it in `connectors.json`, and
> the runtime registry will pick the connector type up at startup.

Continuously sync Oracle tables to Iceberg using LogMiner for CDC, or snapshot-based reads.

## Sync model

- **Continuous schedule**: Uses Oracle LogMiner to tail the redo log and capture inserts, updates, and deletes with sub-second latency.
- **Periodic schedule**: Watermark-based incremental reads or full snapshot.

DataShuttle connects to Oracle via **Oracle REST Data Services (ORDS)** over HTTP/HTTPS. No OCI client or JDBC driver is required.

## Prerequisites

- Oracle Database 12c+ (Standard or Enterprise, CDB or non-CDB)
- Oracle REST Data Services (ORDS) installed and accessible
- A dedicated user with the following grants:

```sql
-- Schema access
GRANT SELECT ANY TABLE TO datashuttle;
GRANT SELECT ON V_$DATABASE TO datashuttle;
GRANT SELECT ON V_$LOG TO datashuttle;
GRANT SELECT ON V_$LOGFILE TO datashuttle;
GRANT SELECT ON V_$ARCHIVED_LOG TO datashuttle;
GRANT SELECT ON V_$LOG_HISTORY TO datashuttle;

-- LogMiner
GRANT EXECUTE ON DBMS_LOGMNR TO datashuttle;
GRANT EXECUTE ON DBMS_LOGMNR_D TO datashuttle;
GRANT LOGMINING TO datashuttle;

-- Supplemental logging on each table (required for UPDATE/DELETE capture)
ALTER TABLE SCOTT.ORDERS ADD SUPPLEMENTAL LOG DATA (ALL) COLUMNS;
```

## CREATE CONNECTION

```sql
CREATE CONNECTION oracle_prod
  TYPE ORACLE
  PROPERTIES (
    host = 'oracle.internal',
    port = '8080',
    service_name = 'ORCLPDB1',
    username = 'datashuttle',
    password = SECRET 'vault://secrets/oracle_pass'
  );
```

For CDB + PDB setup:

```sql
CREATE CONNECTION oracle_cdb
  TYPE ORACLE
  PROPERTIES (
    host = 'oracle.internal',
    port = '8080',
    service_name = 'ORCL',
    pdb_name = 'ORCLPDB1',
    username = 'C##datashuttle',
    password = SECRET 'vault://secrets/oracle_pass'
  );
```

### Connection properties

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `host` | Yes | — | Oracle hostname or IP |
| `port` | No | `8080` | ORDS HTTP port |
| `service_name` | Yes | — | Oracle service name or SID |
| `username` | Yes | — | User with SELECT and LogMiner privileges |
| `password` | Yes | — | Password |
| `pdb_name` | No | — | Pluggable Database name (Oracle 12c+) |
| `logminer_start_scn` | No | current SCN | Starting SCN for LogMiner CDC |
| `tls` | No | `false` | Enable TLS for ORDS |

## CREATE SHUTTLE

```sql
-- Continuous CDC (sub-second latency)
CREATE SHUTTLE oracle_orders
  SOURCE oracle_prod TABLE SCOTT.ORDERS
  TARGET warehouse.raw
  SCHEDULE continuous;

-- Periodic watermark-based sync
CREATE SHUTTLE oracle_events
  SOURCE oracle_prod TABLE DW.FACT_EVENTS
  TARGET warehouse.raw
  SCHEDULE EVERY '30 minutes'
  WITH (watermark_column = 'CREATED_AT');
```

## Type mapping

| Oracle | Arrow | Iceberg |
|--------|-------|---------|
| `NUMBER(p,0)` / `INTEGER` | Int32 / Int64 | `int` / `long` |
| `NUMBER(p,s)` | Decimal128(p,s) | `decimal(p,s)` |
| `NUMBER` (no precision) | Float64 | `double` |
| `FLOAT(n)` / `BINARY_DOUBLE` | Float64 | `double` |
| `BINARY_FLOAT` | Float32 | `float` |
| `VARCHAR2` / `NVARCHAR2` | Utf8 | `string` |
| `CHAR` / `NCHAR` | Utf8 | `string` |
| `CLOB` / `NCLOB` | Utf8 | `string` |
| `RAW` / `LONG RAW` | Binary | `binary` |
| `BLOB` | Binary | `binary` |
| `DATE` | Timestamp(μs, None) | `timestamp` |
| `TIMESTAMP` | Timestamp(μs, None) | `timestamp` |
| `TIMESTAMP WITH TIME ZONE` | Timestamp(μs, UTC) | `timestamptz` |
| `TIMESTAMP WITH LOCAL TIME ZONE` | Timestamp(μs, UTC) | `timestamptz` |
| `INTERVAL YEAR TO MONTH` | Utf8 | `string` |
| `INTERVAL DAY TO SECOND` | Utf8 | `string` |
| `XMLTYPE` | Utf8 | `string` |
| `SDO_GEOMETRY` | Binary | `geometry` (V3) |

## Limitations

- ORDS is required — direct OCI/JDBC connectivity is not supported in this release.
- `LOB` columns (`CLOB`, `BLOB`) larger than the ORDS LOB fetch limit (default 32 KB) may be truncated. Increase `restEnabledSql.maxRows` in ORDS configuration if needed.
- `LONG` and `LONG RAW` legacy types require supplemental logging with `ALL COLUMNS`.
- DDL replication (e.g. `ALTER TABLE ADD COLUMN`) is detected and applied in `compatible` schema evolution mode. Column drops and renames require manual intervention.
