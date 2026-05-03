# GitOps

Manage shuttles as SQL files in Git. Use `datashuttle apply/diff/validate` for CI/CD integration.

## Shuttle-as-Code

Store shuttle definitions as SQL files:

```
shuttles/
├── crm/
│   ├── orders.sql
│   └── customers.sql
└── events/
    └── clickstream.sql
```

Each file contains a `CREATE SHUTTLE` (or `CREATE CONNECTION`) statement.

## Commands

### Validate (dry-run)

Check syntax and references without applying:

```bash
datashuttle validate -f shuttles/
```

Returns exit code 0 if all files are valid. Ideal for CI pre-merge checks.

### Diff

Show what would change compared to the running cluster:

```bash
datashuttle diff -f shuttles/
```

Output:

```
+ orders_sync (new shuttle)
~ customers_sync (modified: commit_interval 30s → 15s)
- legacy_import (not in files, would be pruned)
```

### Apply

Apply the desired state:

```bash
# Apply changes (additive — does not remove unlisted shuttles)
datashuttle apply -f shuttles/

# Apply and remove shuttles not in the files
datashuttle apply -f shuttles/ --prune
```

### Generate

Generate SQL files from existing running shuttles:

```bash
datashuttle generate --source pg_prod --target warehouse --output shuttles/
```

Useful for bootstrapping shuttle-as-code from an existing cluster.

## CI/CD integration

### GitHub Actions example

```yaml
name: Shuttle Deploy
on:
  push:
    branches: [main]
    paths: ['shuttles/**']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Validate
        run: datashuttle validate -f shuttles/
      - name: Diff
        run: datashuttle diff -f shuttles/
      - name: Apply
        run: datashuttle apply -f shuttles/ --prune
```

### Pre-merge validation

Add validation to your PR shuttle:

```yaml
on: pull_request
steps:
  - run: datashuttle validate -f shuttles/
```
