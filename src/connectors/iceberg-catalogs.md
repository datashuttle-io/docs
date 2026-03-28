# Iceberg Catalogs

DataShuttle writes to any Iceberg-compatible catalog. Configure the catalog in `datashuttle.yaml` under `storage`.

## Apache Polaris (default)

The default catalog. Polaris is an Iceberg REST catalog with **credential vending** — DataShuttle automatically receives short-lived S3/GCS/ADLS credentials from the catalog instead of requiring long-lived cloud keys.

```yaml
storage:
  catalog_type: rest
  catalog_uri: "http://localhost:8181/api/catalog"
  warehouse: "s3://warehouse/"
```

No special configuration needed — this is the default in both `datashuttle.yaml` and `docker-compose.yaml`.

## Project Nessie

Nessie provides Git-like branching for Iceberg tables.

```yaml
storage:
  catalog_type: nessie
  catalog_uri: "http://localhost:19120/api/v1"
  warehouse: "s3://warehouse/"
```

Or via environment variables:

```bash
DS_CATALOG_TYPE=nessie DS_CATALOG_URI=http://nessie:19120/api/v1 datashuttle start
```

Docker Compose — replace the Polaris service:

```yaml
  nessie:
    image: ghcr.io/projectnessie/nessie:latest
    ports:
      - "19120:19120"
```

## AWS Glue

```yaml
storage:
  catalog_type: glue
  catalog_uri: ""              # Uses AWS SDK default endpoint
  warehouse: "s3://my-data-lake/warehouse/"
```

Requires IAM permissions for Glue API access. Uses the default AWS credential chain.

## Hive Metastore

```yaml
storage:
  catalog_type: hive
  catalog_uri: "thrift://hive-metastore:9083"
  warehouse: "s3://my-data-lake/warehouse/"
```
