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
