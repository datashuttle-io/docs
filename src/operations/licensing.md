# Licensing

## License Management

DataShuttle runs without a license in Community tier (free, 10K DPU/month).
To unlock paid features, place a license file in one of:

1. `DATASHUTTLE_LICENSE` env var (base64-encoded JSON)
2. `DATASHUTTLE_LICENSE_FILE` env var (file path)
3. `licenses/` directory in working directory

## CLI Commands

```bash
# Show license details, tier, and environment fingerprint
datashuttle license info

# Verify license signature and dates
datashuttle license verify

# List known environments
datashuttle license environments

# Sign a license (admin tool)
datashuttle license sign --document license.json --key signing.key --output signed.json

# Show DPU usage
datashuttle usage show
datashuttle usage show --namespace core.dpu --since 2026-04-01T00:00:00Z

# Export usage for reconciliation
datashuttle usage export --format json --output report.json
datashuttle usage export --format csv --output report.csv

# Verify usage ledger integrity
datashuttle usage verify
```

## Hot Reload

Reload license without restart:
```bash
kill -HUP $(pidof datashuttle)
```

## Airgapped Operation

1. Transfer license file via secure media
2. `datashuttle license activate`
3. Usage recorded to local signed ledger
4. Quarterly: `datashuttle usage export` generates reconciliation report
5. Renewal: swap license file + SIGHUP

## Key Rotation Runbook

### Planned Root Key Rotation

1. Generate new Ed25519 keypair
2. Embed new public key in next binary release
3. Keep old key accepted for 6 months (transition period)
4. Re-sign all active customer licenses with new key
5. After transition: remove old key from binary

### Emergency Key Rotation (Compromise)

1. Generate new keypair immediately
2. Emergency binary release with new public key
3. Invalidate all existing licenses (force re-issue)
4. Notify all customers with new license files
5. Old key removed from binary — no transition period

## Incident Response Playbook

### Vendor Certificate Compromise

1. Revoke vendor cert via CRL update
2. In airgap: short-TTL vendor certs expire naturally
3. Issue replacement cert to vendor
4. Notify affected customers

### Customer License Leak

1. Invalidate `license_id` in portal
2. Issue replacement license with new `license_id`
3. Customer swaps file, sends SIGHUP

### Usage Ledger Tampering

1. `datashuttle usage verify` detects chain breaks
2. Tampered entries flagged by signature verification
3. Escalate to account team for reconciliation
4. Contract enforcement via audit rights clause

## Trust and Revocation

- Ed25519 signatures — cannot forge entitlements
- `valid_until` + grace — cannot use expired license indefinitely
- Ledger chain integrity — cannot retroactively alter usage records
- Cloud: metering is authoritative, no client-side bypass
- Self-hosted: contractual enforcement + quarterly reconciliation
- Airgapped: honor-based + audit rights
