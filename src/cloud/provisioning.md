# Tenant Provisioning (SaaS)

> **OSS users:** you can ignore this entire page. The default DataShuttle build
> does **not** pull in any AWS SDK crates, makes no external network calls on
> tenant creation, and runs the in-memory
> `datashuttle_api::tenant::provision_tenant` path. This doc describes an
> opt-in SaaS build.

The `TenantProvisioner` is a cloud-facing provisioning shuttle built on top
of the [Saga primitive](../concepts/saga.md): each resource creation step
returns a compensator, and any failure triggers reverse-order rollback. It
lives in `crates/datashuttle-api/src/provisioning/` and is wired into
`AppState` as `state.provisioner`.

## What it provisions

Three steps run as a single saga under the name `"tenant-provision"`:

| # | Step                     | File                      | Side effect                                                                             |
|---|--------------------------|---------------------------|-----------------------------------------------------------------------------------------|
| 1 | `CreateTenantPrefix`     | `provisioning/s3.rs`      | `HeadObject` → `PutObject` a 0-byte `<tenant>/.keep` under the tenant bucket.          |
| 2 | `CreateTenantPolicy`     | `provisioning/iam.rs`     | `PutRolePolicy` on the configured tenant role, scoping access by `aws:PrincipalTag/tenant_id`. |
| 3 | `CreateCatalogNamespace` | `provisioning/polaris.rs` | `GET` then (if missing) `POST /api/catalog/v1/namespaces` on Polaris with `location` set to the S3 prefix. |

Every step is **idempotent**: a GET / HEAD probe short-circuits the mutation
on a retried run. Every step emits a compensator that undoes the mutation
(`DeleteObject`, `DeleteRolePolicy`, `DELETE /namespaces/<tenant>`). The
Polaris step is compiled in every build — it uses only `reqwest`. The S3
and IAM steps live behind the `saas-aws` cargo feature.

## Build matrix

| Feature flags                          | What gets compiled                                 |
|----------------------------------------|----------------------------------------------------|
| *(default)*                            | No AWS SDK. `TenantProvisioner::new_noop()` and `new_polaris_only(...)` only. |
| `--features saas-aws`                  | Adds `aws-sdk-s3`, `aws-sdk-iam`, `aws-config`. Enables `TenantProvisioner::from_config(...)`. |

The CI gate `scripts/check-onprem-compat.sh` fails the build if any
`aws-sdk-*` crate shows up in the default `cargo tree -p datashuttle-cli` or
`cargo tree -p datashuttle-api`.

## Configuration

Add to `datashuttle.yaml`:

```yaml
provisioning:
  enabled: true                               # default: false
  aws_region: "us-east-1"
  s3_bucket: "datashuttle-tenants-prod"
  s3_endpoint_url: null                       # override for LocalStack / MinIO
  iam_role_name_template: "datashuttle-tenant-{tenant_id}"
  polaris_url: "https://polaris.example.com"
  polaris_token_ref: "secret://aws-sm/prod/polaris#token"
```

All fields are optional; when `enabled = false` (the default), the
provisioner is a no-op regardless of the other values.

- `polaris_token_ref` is resolved through the same
  [`SecretResolver`](./secrets.md) used by shuttle connections. If it is
  unset, the provisioner falls back to the `DS_POLARIS_TOKEN` environment
  variable.
- `aws_region` and AWS credentials follow the standard AWS credential chain
  (env, shared config, IMDS). No DataShuttle-specific env vars are needed.

## Running against AWS

```bash
cargo build --release -p datashuttle-api --features saas-aws
AWS_REGION=us-east-1 \
AWS_ACCESS_KEY_ID=... \
AWS_SECRET_ACCESS_KEY=... \
DS_POLARIS_TOKEN=... \
./target/release/datashuttle
```

## Async provisioning workflow (task 2.3)

When `provisioning.enabled: true`, `POST /api/v1/orgs` returns **`202
Accepted`** immediately and spawns the saga on a background tokio task:

```
POST /api/v1/orgs         ──► 202 Accepted
                              { tenant_id, provisioning_id,
                                status: "provisioning", … }

(background saga)
  CreateTenantPrefix  (S3)
  CreateTenantPolicy  (IAM)
  CreateCatalogNamespace (Polaris)

(success)                  ──► tenant.status = Active
                              WebSocket: "tenant.provisioned"

(failure)                  ──► tenant.provisioning_step = Failed
                              tenant.error_message = "<saga error>"
                              WebSocket: "tenant.provisioning_failed"
```

Clients have two ways to observe completion:

- **Polling**: `GET /api/v1/tenants/{id}/provisioning` returns
  `{ tenant_id, status, step, progress, error, started_at, completed_at }`.
  The `progress` field is a string like `"3/5"`; the `step` field is
  one of `create_namespace`, `create_tenant_prefix`,
  `create_tenant_policy`, `create_catalog_namespace`, `activate`,
  `failed`.
- **WebSocket subscription**: subscribers on the existing `/ws/*`
  channel receive `ShuttleEvent` records with `event_type ==
  "tenant.provisioned"` or `"tenant.provisioning_failed"`. Payload:
  `{ tenant_id, provisioning_id, status }` or `{ tenant_id,
  provisioning_id, error }`.

### Idempotency

`POST /api/v1/orgs` is idempotent *per `org_id`*. Re-posting the same
name returns the existing tenant's current provisioning state
(whichever of sync/async it's in) without re-spawning the saga.

### Restart semantics

On startup `AppState` runs a sweep
(`resume_pending_provisioning`) that marks any tenant still in
`Provisioning` for more than 5 minutes as `Failed`. Operators can
`DELETE` the row and retry. A richer saga-resume strategy (checkpoint
the ProvisioningContext to Postgres) is tracked for a future phase.

## Suspension and hard-delete (task 2.4)

`POST /api/v1/tenants/{id}/suspend` pauses every shuttle in the
tenant namespace and — when provisioning is enabled — flips the
Polaris namespace to `readonly = "true"` by PUTting
`/api/catalog/v1/namespaces/{id}/properties`. A suspended tenant can
still read data; all new writes are rejected by Polaris until the
tenant is resumed.

`DELETE /api/v1/tenants/{id}` soft-deletes (30-day grace). The
hard-delete sweep (`hard_delete_tenant`) drops shuttles, removes the
tenant row, and calls
`TenantProvisioner::purge_tenant_resources(tenant_id, force_purge_data)`.
By default, only the IAM policy, Polaris namespace, and
`.keep` marker are removed — Iceberg data under the tenant S3 prefix
is **retained** for operator review. Pass `force_purge_data = true`
to recursively delete objects under the prefix.

`GET /api/v1/tenants/{id}/export` returns the tenant JSON dump. When
provisioning is enabled, the response also contains `export_url.url`
— currently an `s3://bucket/{tenant_id}/` pointer plus a TTL hint.
Operators use it to drive `aws s3 sync` or list-by-prefix; a future
iteration will presign a real listing / zip URL.

## Guarantees summary

| Concern              | Default OSS build                 | SaaS (`provisioning.enabled: true`) |
|----------------------|-----------------------------------|-------------------------------------|
| `POST /api/v1/orgs`  | `201 Created` + in-memory tenant  | `202 Accepted` + background saga    |
| Tenant lifecycle     | in-memory only                    | saga-backed side effects            |
| `suspend`            | shuttle pause only               | shuttle pause + Polaris read-only  |
| `hard delete`        | in-memory only                    | IAM + Polaris + `.keep` cleanup     |
| `export`             | JSON dump                         | JSON + presigned S3 export URL      |
| `POST /api/v1/orgs` idempotency | per org_id                       | per org_id                          |

## Running against LocalStack

[LocalStack](https://www.localstack.cloud/) emulates S3 + IAM locally.

```bash
docker run --rm -p 4566:4566 localstack/localstack
awslocal s3 mb s3://datashuttle-tenants-dev
awslocal iam create-role --role-name datashuttle-tenant-acme \
  --assume-role-policy-document file://trust.json

export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_REGION=us-east-1
cat >> datashuttle.yaml <<'YAML'
provisioning:
  enabled: true
  aws_region: us-east-1
  s3_bucket: datashuttle-tenants-dev
  s3_endpoint_url: http://localhost:4566
  iam_role_name_template: "datashuttle-tenant-{tenant_id}"
YAML

cargo run -p datashuttle-api --features saas-aws
```

Verify:

```bash
awslocal s3api head-object --bucket datashuttle-tenants-dev --key acme/.keep
awslocal iam get-role-policy --role-name datashuttle-tenant-acme \
  --policy-name datashuttle-tenant-acme
```

## Testing

Unit tests for the Polaris step use `wiremock` and run on every CI pass:

```bash
cargo test -p datashuttle-api --lib provisioning::
```

AWS-side coverage is deliberately light until the `aws-smithy-mocks-experimental`
crate stabilises in our dep graph. Integration against real AWS / LocalStack
is opt-in; see the recipe above. The policy document and role-name
substitution helpers *are* covered by pure unit tests (no AWS client
required) so any drift in the ARN pattern or `PrincipalTag` condition is
caught at `cargo test`.

## Failure semantics

`provision(ctx)` returns a `Result<ProvisioningContext, ProvisionError>`.
On failure:

1. The first step that returns `StepError` halts execution.
2. Compensators for completed steps run in reverse order. Compensator
   failures are logged at `warn!` but **do not** mask the original error.
3. The caller sees `ProvisionError::Saga(SagaError::Step { step, source })`
   with the original error as `source` so retries can be idempotent.

## Additive to on-prem

The existing in-memory `provision_tenant` flow (defined in the api
crate's `tenant` module) continues to run unchanged for OSS deployments,
tests, and any SaaS
install that keeps `provisioning.enabled = false`. The two paths coexist
until Task 2.3 replaces the in-memory call site with a gated dispatch to
`state.provisioner`.
