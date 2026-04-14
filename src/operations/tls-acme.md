# TLS & ACME / Let's Encrypt

DataShuttle can terminate TLS directly at the API server. For on-prem
installs with public DNS, the recommended path is **ACME / Let's Encrypt
automation** — the server requests and auto-renews certs with zero
config files. Operators who already own a cert bundle can use the
`file` mode instead, and anything fronted by an Ingress / LoadBalancer
that terminates TLS upstream can stay on the `none` default.

## Modes at a glance

| `tls.mode` | Required dependencies | When to use |
|------------|----------------------|-------------|
| `none` (default) | — | TLS terminated upstream (ingress, ELB, service mesh). Preserves historical behavior. |
| `file` | Existing PEM cert + key on disk | Wildcard certs from a corporate PKI, offline CA. |
| `acme` | Public DNS + build with `--features acme` | Internet-facing on-prem with no in-house CA. |

The ACME path requires building the `datashuttle-api` crate with
`--features acme`. The default OSS build keeps the dependency graph
lean; opting in pulls in `instant-acme`, `rustls`, `rcgen`, and
`axum-server`.

## Quick-start (ACME)

1. Point one or more public DNS records at your API server.
2. Open port 80 (HTTP-01) **or** port 443 (TLS-ALPN-01) to the internet.
3. Configure `datashuttle.yaml`:

   ```yaml
   tls:
     mode: acme
     acme:
       domains:
         - app.example.com
       contact_email: ops@example.com
       challenge: http-01           # or tls-alpn-01
       renewal_days_before_expiry: 30
       cache_dir: /var/lib/datashuttle/acme
   ```

4. Start the server built with `--features acme`:

   ```bash
   cargo build --release --features acme -p datashuttle-cli
   ./target/release/datashuttle start --config datashuttle.yaml
   ```

On first boot the server:

1. Creates an ACME account and caches the account key under
   `cache_dir/account.json`.
2. Places an order for the listed domains.
3. Completes the requested challenge type.
4. Downloads the issued cert + key and caches them to disk.
5. Starts serving HTTPS on the configured API address.

## Helm

Pass the same settings through Helm values:

```yaml
tls:
  mode: acme
  acme:
    enabled: true
    domains:
      - app.example.com
    contactEmail: ops@example.com
    challenge: http-01
```

When `tls.mode = acme` and `challenge = http-01`, the chart
automatically exposes an additional **port 80** on the Service and
StatefulSet for the ACME challenge handshake. With `challenge =
tls-alpn-01`, only the standard API port is exposed.

## Renewal

- A background task wakes every hour and checks whether the current
  cert has fewer than `renewal_days_before_expiry` days remaining
  (default: 30).
- When the threshold is crossed, the task requests a new cert,
  swaps it into the in-memory rustls `ServerConfig`, and persists
  the new cert + key under `cache_dir`.
- Hot-swaps happen **without a server restart** — existing
  connections drain naturally; new connections pick up the
  refreshed config.
- Monitor renewals via the `ACME: certificate issued and cached`
  log line. Persist `cache_dir` across restarts (Helm chart mounts
  `/var/lib/datashuttle/acme` onto the persistence volume by default).

## Choosing a challenge type

- **HTTP-01** (default): simplest. Requires port 80 reachable from
  the public internet. Works with every DNS provider.
- **TLS-ALPN-01**: needs only port 443. Useful when port 80 is
  blocked or already taken by another service on the node. Does
  **not** need an extra Service port.

## Troubleshooting

### Rate limits

Let's Encrypt enforces strict per-domain and per-account rate limits
(most notably 50 certificates per registered domain per week). When
iterating, point `tls.acme.directory` at the **staging** directory:

```yaml
tls:
  acme:
    directory: https://acme-staging-v02.api.letsencrypt.org/directory
```

### "order became Invalid"

The CA couldn't validate ownership:

- For HTTP-01: check that `http://<domain>/.well-known/acme-challenge/<token>`
  is reachable from the public internet. Watch for L7 load balancers
  that strip the path or force-redirect to HTTPS.
- For TLS-ALPN-01: check that port 443 is reachable and the server
  has finished booting before the CA polls.

### DNS not propagated

Make sure A / AAAA records are resolvable from outside your network
before starting the server. The CA resolves independently from any
split-horizon DNS you may run internally.

### Port 80 unreachable

If HTTP-01 fails repeatedly, switch to `challenge: tls-alpn-01`. You
can revert to HTTP-01 later once port 80 is reachable.

## `file` mode

`file` mode terminates TLS with a locally-managed cert bundle. It is
documented here for completeness — the current implementation refuses
at startup and asks operators to either:

- Front the API with a TLS-terminating reverse proxy
  (nginx / envoy / Traefik), or
- Switch to `tls.mode: acme` for automatic issuance.

Native `file`-mode termination will ship in a follow-up release.

## File-mode and ACME-mode coexistence

**Not supported.** Pick one TLS strategy per install. Running both
would require coordinating cert issuance with an external PKI, which
is out of scope for the built-in ACME manager. If you need both a
corporate-CA cert and an internet-facing Let's Encrypt cert, put a
reverse proxy in front and leave DataShuttle on `tls.mode: none`.
