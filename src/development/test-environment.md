# Test Environment

`deploy/test-compose.yaml` spins up every service the DataShuttle
integration suite needs — the same stack CI uses — so new contributors
can run the suite locally without hand-installing Postgres, Kafka,
MinIO, Polaris, Jaeger, Grafana, etc.

## Quick start

```sh
# Bring up the minimal profile (postgres + redis).
make test-up

# Or the full kitchen-sink (every profile, every service).
make test-up-all

# Run the integration suite against it.
make test-integration

# Tear everything down and remove volumes.
make test-down
```

`make test-up` should have everything healthy in under 60 seconds on a
warm image cache. The underlying `docker compose ... up -d --wait` call
blocks on service healthchecks so, when the command returns, the stack
is ready to accept connections.

## Profiles

| Profile         | Services                                                           |
|-----------------|--------------------------------------------------------------------|
| `minimal`       | postgres, redis                                                    |
| `catalogs`      | postgres, redis (via minimal), polaris, minio                      |
| `sources`       | postgres, minio, kafka + zookeeper, mongodb, mysql, clickhouse, keycloak |
| `observability` | postgres, redis, minio, jaeger, otel-collector, prometheus, grafana |
| `all`           | everything                                                         |

Pick a profile with the `COMPOSE_PROFILE` variable:

```sh
make test-up COMPOSE_PROFILE=sources
```

Profiles are composable — Docker Compose's own `--profile` flag lets
you combine them:

```sh
docker compose -f deploy/test-compose.yaml \
  --profile catalogs --profile sources up -d --wait
```

## Port mappings

All services are exposed on host ports offset from their canonical
defaults so the stack coexists with local installs. See
`deploy/test-compose.yaml` for the authoritative list.

| Service      | Host port | Notes                             |
|--------------|-----------|-----------------------------------|
| postgres     | 5433      | default 5432 offset               |
| redis        | 6380      | default 6379 offset               |
| minio S3     | 9100      | default 9000 offset               |
| minio UI     | 9101      | default 9001 offset               |
| polaris      | 8281      | default 8181 offset               |
| kafka        | 9093      | `PLAINTEXT_HOST` advertised       |
| mongodb      | 27018     | default 27017 offset              |
| mysql        | 3307      | default 3306 offset               |
| clickhouse   | 8124 / 9001 | HTTP / native                   |
| keycloak     | 8088      |                                   |
| jaeger UI    | 16686     |                                   |
| jaeger OTLP  | 4317/4318 | gRPC / HTTP                       |
| otel-collector | 4319/4320 | non-colliding OTLP entry        |
| prometheus   | 9091      | default 9090 offset               |
| grafana      | 3001      | default 3000 offset               |

## Credentials (NOT FOR PROD)

Development defaults only. All secrets are trivially guessable — never
reuse them in production.

| Service     | User           | Password         |
|-------------|----------------|------------------|
| postgres    | `postgres`     | `postgres`       |
| mysql root  | `root`         | `mysql`          |
| mysql app   | `datashuttle`  | `datashuttle`    |
| mongodb     | `mongo`        | `mongo`          |
| clickhouse  | `default`      | `clickhouse`     |
| minio       | `minioadmin`   | `minioadmin`     |
| polaris     | `root`         | `s3cr3t`         |
| keycloak    | `admin`        | `admin`          |
| grafana     | `admin`        | `admin` (+ anon) |

## Running specific integration tests

The Makefile exports a `DS_TEST_*` URL for every host-exposed service.
Individual tests pick these up:

```sh
make test-up COMPOSE_PROFILE=sources

DS_TEST_KAFKA_URL=localhost:9093 \
  cargo test -p datashuttle-cdc --test integration_connectors -- \
  --include-ignored kafka
```

Or override just one URL on the command line:

```sh
make test-integration DS_TEST_KAFKA_URL=localhost:9093
```

## Observability profile

With `COMPOSE_PROFILE=observability` (or `all`), Prometheus scrapes
metrics from DataShuttle running on the host
(`host.docker.internal:9090`), loads
[`deploy/prometheus/alerts.yaml`](../operations/dashboards.md#loading-alert-rules)
as its rule file, and Grafana auto-provisions the bundled dashboards
from `deploy/grafana/dashboards/`.

Open:

- Grafana:     <http://localhost:3001>  (anon access enabled)
- Prometheus:  <http://localhost:9091>
- Jaeger:      <http://localhost:16686>

## CI integration

GitHub Actions runs this same stack on every push to `main` via the
`integration-tests` job in `.github/workflows/ci.yaml`. PRs can opt in
by adding the `integration` label.

## Troubleshooting

- **`make test-up` hangs on `--wait`** — one of the healthchecks is
  failing. Run `make test-status` and `docker compose -f
  deploy/test-compose.yaml logs <service>` to investigate.
- **Port already in use** — you likely have a local Postgres/Kafka/etc.
  Kill it or change the host port in `deploy/test-compose.yaml`.
- **MongoDB replica-set errors on first start** — initialise the RS
  with `mongosh mongodb://mongo:mongo@localhost:27018 --eval
  'rs.initiate()'`.
- **`host.docker.internal` not resolving on Linux** — add
  `--add-host=host.docker.internal:host-gateway` to your compose
  override, or run DataShuttle inside the compose network.
