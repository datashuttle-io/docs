# Local Auth Mode

`auth.mode: local` lets a small operations team log in to DataShuttle via
the browser without configuring an external OIDC provider (Keycloak,
Okta, Auth0, ...). Users live in `datashuttle.yaml`, passwords are
stored as one-way hashes, and `/auth/login` mints a short-lived session
JWT served as an HttpOnly cookie.

> Tracking issue: [#562](https://github.com/datashuttle-ai/datashuttle/issues/562)

---

## Quick start

### 1. Generate a password hash

```sh
# Recommended: pipe the password on stdin so it never appears in shell history.
echo -n 'super-secret-password' | datashuttle users hash --stdin
# → abcd1234ef...:9af0...   (OSS build, SHA-256 + per-user salt)
# → $argon2id$v=19$m=19456$...   (Cloud build, Argon2id)
```

You can also pass the password explicitly with `--password <pwd>` or via the
`DS_PASSWORD` environment variable. Both formats verify against each other,
so an OSS-generated hash works on a Cloud-feature server and vice versa.

### 2. Add the user to `datashuttle.yaml`

```yaml
auth:
  mode: local
  users:
    - email: admin@company.local
      password_hash: "abcd1234ef...:9af0..."   # paste output from step 1
      roles: [admin]
    - email: ops@company.local
      password_hash: "..."
      roles: [data_ops, viewer]
```

### 3. Restart the server

```sh
datashuttle start --config /etc/datashuttle/datashuttle.yaml
```

### 4. Log in

```sh
curl -X POST http://localhost:8080/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@company.local","password":"super-secret-password"}'
```

The response contains:
- a JSON body with `token`, `user_id`, `email`, `expires_at`
- a `Set-Cookie: ds_session=...; HttpOnly; Secure; SameSite=Strict; Path=/` header

The browser UI honours the cookie automatically. CLI / API clients can
present the token as `Authorization: Bearer <token>`.

### 5. Log out

```sh
curl -X POST http://localhost:8080/api/v1/auth/logout \
  -H "Authorization: Bearer $TOKEN"
```

Logout is idempotent (always returns 204) and revokes the session JTI in
the session store, so the same token cannot be reused.

---

## CLI helpers

```text
datashuttle users hash   --stdin                              # generate hash
datashuttle users list   --config /etc/datashuttle.yaml       # list configured users
datashuttle users verify --email admin@company.local \
                         --password '...'                     # check a hash
                         --config /etc/datashuttle.yaml
```

`datashuttle users list` prints `[REDACTED]` instead of the password hash —
safe to paste into tickets or email.

---

## Security notes

- **Lock the config file.** Even though `password_hash` is hashed, the
  hashes are still secrets — anyone who can read the file can attempt an
  offline brute-force attack against weak passwords. Use Unix
  permissions:
  ```sh
  chmod 0600 /etc/datashuttle/datashuttle.yaml
  chown root:root /etc/datashuttle/datashuttle.yaml
  ```
- **`DS_JWT_SECRET` must be set in production.** Without it, the server
  generates a random per-process secret (fine for dev) and all sessions
  are invalidated on restart.
- **HTTPS strongly recommended.** The session cookie is `Secure`, which
  means browsers refuse to send it over plain HTTP. Front the API with
  TLS termination (nginx, traefik, Caddy, AWS ALB, ...).
- **Session TTL is 24h by default.** This is set inside
  `SessionManager::from_env`. `/auth/logout` revokes the token immediately.
- **Hash format depends on build.** OSS builds emit SHA-256
  (`salt_hex:hash_hex`). Cloud / `--features saas` builds emit Argon2id
  (`$argon2id$v=19$m=19456$...`). Both formats verify against each other,
  so OSS → Cloud upgrades require zero re-hashing.
- **No registration in Local mode.** `/auth/register` is intended for
  the SaaS user store. Provision Local-mode users by editing the YAML.

---

## Comparison with other auth modes

| Mode      | Best for                          | Browser login | Logout | External IdP needed |
| --------- | --------------------------------- | ------------- | ------ | ------------------- |
| `none`    | local dev only                    | n/a           | n/a    | no                  |
| `basic`   | scripts behind a VPN              | yes (ugly)    | no     | no                  |
| `api_key` | machine-to-machine, CI            | no            | no     | no                  |
| `local`   | small on-prem teams (this page)   | **yes**       | **yes**| **no**              |
| `oidc`    | enterprise SSO (Keycloak, Okta)   | yes           | yes    | yes                 |

Use `oidc` if you already have an identity provider; use `local` for a
self-contained, browser-friendly setup with no external dependencies.
