# CLI Commands

```bash
datashuttle start           # start server
datashuttle status          # cluster health
datashuttle pipeline list   # list pipelines
datashuttle pipeline status <name>
datashuttle pipeline pause <name>
datashuttle pipeline resume <name>
datashuttle sql -e "..."    # execute SQL
datashuttle validate -f dir/
datashuttle diff -f dir/
datashuttle apply -f dir/
datashuttle generate --source conn --target ns --output dir/
datashuttle deadletter list <pipeline>
datashuttle version
```

Use `-o json` or `-o yaml` for machine-readable output.
