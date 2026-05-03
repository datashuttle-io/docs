# Secret Management

DataShuttle supports pluggable secret providers so credentials never have to
live in plaintext YAML. This page covers the supported providers, how to
migrate an existing plaintext config, and the security guarantees of each
provider.

> **Scope of this feature (#569).** Server-level credentials — S3 access
> keys, OAuth2 client secret for the catalog, SMTP password — are resolved
> via the provider system at startup. Connection-option secrets (source DB
> passwords, API keys) resolve per-shuttle when the shuttle starts.

## Quick reference

Every secret-bearing field accepts either a plain string (legacy behaviour)
or a `secret://<provider>/<path>[#field]` reference. Recognised providers:

| Scheme               | Provider class                | Default build | Notes |
|----------------------|-------------------------------|---------------|-------|
| `secret://env/...`   | `EnvProvider`                 | ✓             | Reads a process env var. |
| `secret://file/...`  | `FileSecretProvider`          | ✓             | Reads a file on disk. |
| `secret://k8s/...`   | `KubernetesSecretProvider`    | ✓             | Reads a mounted K8s `Secret`. |
| `secret://vault/...` | `VaultProvider`               | ✓             | HashiCorp Vault over HTTP. |
| `secret://aws-sm/...`| `AwsSmProvider`               | feature-gated | Requires the `secrets-aws` crate feature. |
| `secret://gcp-sm/...`| `GcpSmProvider`               | feature-gated | Requires the `secrets-gcp` crate feature. |
| `secret://azure-kv/...`| `AzureKvProvider`           | feature-gated | Requires the `secrets-azure` crate feature. |

Legacy URI-style forms (`vault://...`, `env://...`, `k8s://...`,
`file://...`, `aws-sm://...`, `gcp-sm://...`, `azure-kv://...`) are also
accepted so existing configs keep working.

A plain-string value (no `secret://` prefix) is treated as a literal — this
is the backward-compat guarantee. No existing YAML needs to change to pick
up the new system.

## Covered config fields

The config post-load pass resolves the following fields automatically:

- `storage.s3_access_key`
- `storage.s3_secret_key`
- `storage.oauth2_client_secret`
- `email.smtp_password`

Connection-option maps (source DB passwords etc.) are resolved by the
shuttle manager at shuttle-start time. Option keys treated as secrets
(resolved if the value is a `secret://...` reference): `password`,
`secret_key`, `api_key`, `token`, `auth_token`, `access_token`.

## Migrating from plaintext YAML

### Before

```yaml
storage:
  s3_access_key: "AKIAEXAMPLE"
  s3_secret_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
  oauth2_client_secret: "catalog-client-secret"

email:
  smtp_password: "hunter2"
```

### After (environment variables)

```yaml
storage:
  s3_access_key: "secret://env/S3_ACCESS_KEY"
  s3_secret_key: "secret://env/S3_SECRET_KEY"
  oauth2_client_secret: "secret://env/CATALOG_OAUTH2_SECRET"

email:
  smtp_password: "secret://env/SMTP_PASSWORD"
```

Then set the env vars at launch time (systemd unit, docker-compose file,
K8s Deployment `env:` list, etc.).

### After (HashiCorp Vault)

```yaml
storage:
  s3_access_key: "secret://vault/prod/s3#access_key_id"
  s3_secret_key: "secret://vault/prod/s3#secret_access_key"
  oauth2_client_secret: "secret://vault/prod/catalog#client_secret"

email:
  smtp_password: "secret://vault/prod/smtp#password"
```

At startup, export `VAULT_ADDR` and `VAULT_TOKEN` and register a
`VaultProvider` with the resolver (done automatically once
`secrets.provider: vault` is set in `datashuttle.yaml`).

### After (Kubernetes mounted secrets)

When DataShuttle runs in a pod with Secret volumes projected at
`/var/run/secrets/...`, reference the mount directly:

```yaml
storage:
  s3_access_key: "secret://k8s/s3-creds#access_key_id"
  s3_secret_key: "secret://k8s/s3-creds#secret_access_key"

email:
  smtp_password: "secret://k8s/smtp-creds#password"
```

Corresponding Deployment volume:

```yaml
volumes:
  - name: s3-creds
    secret:
      secretName: s3-creds
  - name: smtp-creds
    secret:
      secretName: smtp-creds
volumeMounts:
  - name: s3-creds
    mountPath: /var/run/secrets/s3-creds
    readOnly: true
  - name: smtp-creds
    mountPath: /var/run/secrets/smtp-creds
    readOnly: true
```

### After (file on disk)

For air-gapped deployments where secrets are materialised onto the
filesystem by an operator (e.g. via Ansible vault):

```yaml
storage:
  s3_access_key: "secret://file/etc/datashuttle/s3.env#ACCESS_KEY"
  s3_secret_key: "secret://file/etc/datashuttle/s3.env#SECRET_KEY"
```

With `/etc/datashuttle/s3.env` containing:

```
ACCESS_KEY=AKIAEXAMPLE
SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

Files are also accepted as JSON. DataShuttle warns (does not error) on Unix
if the file mode is looser than `0600` — tighten with
`chmod 0600 /etc/datashuttle/s3.env`.

### After (AWS Secrets Manager — feature-gated)

> Requires building DataShuttle with the `secrets-aws` crate feature:
> `cargo build --features secrets-aws`. The default on-prem build does
> **not** compile the AWS provider, keeping the dep graph free of AWS
> SDK crates.

```yaml
storage:
  s3_access_key: "secret://aws-sm/prod/s3#access_key_id"
  s3_secret_key: "secret://aws-sm/prod/s3#secret_access_key"
```

### After (GCP Secret Manager — feature-gated)

> Requires building with `--features secrets-gcp`.

```yaml
storage:
  s3_access_key: "secret://gcp-sm/my-project/s3-key"
```

### After (Azure Key Vault — feature-gated)

> Requires building with `--features secrets-azure`.

```yaml
email:
  smtp_password: "secret://azure-kv/my-vault/smtp-password"
```

## Security notes

### File permissions

- Secret files referenced via `secret://file/...` should be mode `0600`
  and owned by the DataShuttle service user.
- DataShuttle **warns** in the log if the mode is looser (any group/other
  bit set). Tighten with `chmod 0600 <path>`.
- K8s `Secret` mounts are always `0400` by default — no action needed.

### Redaction

Secrets are never written back through `serde`. The `StorageConfig` and
`EmailConfig` types use `#[serde(skip_serializing)]` on credential fields
and custom `Debug` implementations that render `[REDACTED]`. Logs, config
dumps, and API responses all go through these paths.

### Rotation

Resolved values are cached with a 5-minute TTL (`SecretResolver::new`).
Operators can trigger an immediate re-resolve by sending `SIGHUP` to the
DataShuttle process — the resolver exposes a `refresh()` hook for this
purpose.

> **Note.** SIGHUP wiring is tracked as a follow-up to #569; the
> underlying `refresh()` API is shipped today but is not yet attached to
> the signal handler in `datashuttle-api`.

### Threat model

The abstraction protects against:

- Operator leaking `datashuttle.yaml` by emailing it / committing it.
- Host-disk exposure via filesystem backups.
- `Debug`/`Display` logs accidentally dumping config.

It does NOT protect against:

- An attacker with process memory access (resolved values live in plain
  memory until rotation).
- An attacker with the ability to set env vars on the DataShuttle process.

## Implementation reference

- Trait and provider types: `crates/datashuttle-traits/src/secret.rs`,
  `crates/datashuttle-core/src/secrets.rs`.
- Post-load config pass: `datashuttle_core::config::resolve_secrets`.
- Per-shuttle options resolution: `SecretResolver::resolve_options`.
- Feature gates: `secrets-aws`, `secrets-gcp`, `secrets-azure`,
  `saas-secrets` (umbrella) — defined in `crates/datashuttle-core/Cargo.toml`.
