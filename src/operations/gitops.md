# GitOps

Manage pipelines as SQL files in Git. Use `datashuttle apply/diff/validate` for CI/CD integration.

## Pipeline-as-Code

Store pipeline definitions as SQL files:

```
pipelines/
├── crm/
│   ├── orders.sql
│   └── customers.sql
└── events/
    └── clickstream.sql
```

Each file contains a `CREATE PIPELINE` (or `CREATE CONNECTION`) statement.

## Commands

### Validate (dry-run)

Check syntax and references without applying:

```bash
datashuttle validate -f pipelines/
```

Returns exit code 0 if all files are valid. Ideal for CI pre-merge checks.

### Diff

Show what would change compared to the running cluster:

```bash
datashuttle diff -f pipelines/
```

Output:

```
+ orders_sync (new pipeline)
~ customers_sync (modified: commit_interval 30s → 15s)
- legacy_import (not in files, would be pruned)
```

### Apply

Apply the desired state:

```bash
# Apply changes (additive — does not remove unlisted pipelines)
datashuttle apply -f pipelines/

# Apply and remove pipelines not in the files
datashuttle apply -f pipelines/ --prune
```

### Generate

Generate SQL files from existing running pipelines:

```bash
datashuttle generate --source pg_prod --target warehouse --output pipelines/
```

Useful for bootstrapping pipeline-as-code from an existing cluster.

## CI/CD integration

### GitHub Actions example

```yaml
name: Pipeline Deploy
on:
  push:
    branches: [main]
    paths: ['pipelines/**']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Validate
        run: datashuttle validate -f pipelines/
      - name: Diff
        run: datashuttle diff -f pipelines/
      - name: Apply
        run: datashuttle apply -f pipelines/ --prune
```

### Pre-merge validation

Add validation to your PR pipeline:

```yaml
on: pull_request
steps:
  - run: datashuttle validate -f pipelines/
```
