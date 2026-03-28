# Configuration

DataShuttle is configured via a YAML file, environment variables, or CLI flags. Values are resolved in order: CLI flags > environment variables > config file > defaults.

## Configuration file

By default, DataShuttle looks for `datashuttle.yaml` in the current directory. Override with `--config`:

```bash
datashuttle start --config /etc/datashuttle/datashuttle.yaml
```

## Example configuration

```yaml
# datashuttle.yaml

# Server
server:
  bind_address: "0.0.0.0"
  api_port: 8080
  metrics_port: 9090
  gossip_port: 7946

# Iceberg catalog
storage:
  catalog_type: rest           # rest | nessie | glue | hive
  catalog_uri: "http://localhost:8181/api/catalog"
  warehouse: "s3://warehouse/"

# Object storage
s3:
  endpoint: "http://localhost:9000"
  region: "us-east-1"
  access_key: "${DS_S3_ACCESS_KEY}"
  secret_key: "${DS_S3_SECRET_KEY}"

# Cluster
cluster:
  seed_nodes: []               # Empty = single-node mode
  node_name: ""                # Auto-generated if empty

# Security
security:
  auth:
    mode: none                 # none | basic | api_key
    # basic_users:
    #   - username: admin
    #     password_hash: "$2b$..."
    # api_keys:
    #   - key_hash: "sha256:..."
    #     name: "ci-bot"

# Webhooks
webhooks: []
  # - url: https://hooks.slack.com/services/T00/B00/xxx
  #   events: [pipeline.error, pipeline.schema.changed]

# Logging
logging:
  level: info                  # trace | debug | info | warn | error
  format: json                # json | pretty
```

## Environment variables

Every config key can be set via environment variable with the `DS_` prefix. Nested keys use `_` as separator:

| Config key | Environment variable |
|------------|---------------------|
| `server.api_port` | `DS_SERVER_API_PORT` |
| `storage.catalog_type` | `DS_CATALOG_TYPE` |
| `storage.catalog_uri` | `DS_CATALOG_URI` |
| `storage.warehouse` | `DS_WAREHOUSE` |
| `s3.endpoint` | `DS_S3_ENDPOINT` |
| `s3.access_key` | `DS_S3_ACCESS_KEY` |
| `s3.secret_key` | `DS_S3_SECRET_KEY` |
| `security.auth.mode` | `DS_AUTH_MODE` |
| `logging.level` | `DS_LOG_LEVEL` |

Environment variables in config values are expanded at startup (e.g., `"${DS_S3_ACCESS_KEY}"`).

## CLI flags

```bash
datashuttle start \
  --config datashuttle.yaml \
  --bind 0.0.0.0 \
  --port 8080 \
  --metrics-port 9090 \
  --seed-nodes node1:7946,node2:7946 \
  --log-level debug
```

## Secret management

Connection passwords support Vault references:

```sql
CREATE CONNECTION pg_prod
  TYPE POSTGRES
  PROPERTIES (
    password = SECRET 'vault://secrets/pg_pass'
  );
```

DataShuttle resolves `vault://` URIs at connection time. For local development, plain strings are accepted.
