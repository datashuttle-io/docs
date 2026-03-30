# Backup & Recovery

DataShuttle stores all persistent state in the Iceberg catalog and object storage. There is no local state to back up.

## What is stored where

| Data | Location | Backed up by |
|------|----------|--------------|
| Pipeline definitions | Iceberg catalog (table properties) | Your catalog backup strategy |
| Sync checkpoints | Iceberg table properties | Your catalog backup strategy |
| Ingested data | Parquet files in object storage | Your storage backup strategy |
| Deletion vectors | Puffin files in object storage | Your storage backup strategy |

## Recovery after node failure

Deploy a new DataShuttle node pointing to the same catalog and storage:

```bash
datashuttle start --config datashuttle.yaml
```

Pipelines resume from their last checkpointed position automatically. No manual intervention needed.

## Recovery after catalog loss

If the Iceberg catalog is lost, DataShuttle cannot resume pipelines (the checkpoint positions are stored there). You would need to:

1. Restore the catalog from backup
2. Start DataShuttle — pipelines resume from the restored checkpoints

Or, if no catalog backup exists:

1. Re-create connections and pipelines
2. Pipelines will re-load from the source

## Recovery after storage loss

If object storage data is lost:

1. Pipeline definitions are safe (in the catalog)
2. Use `datashuttle pipeline resnapshot <name>` to re-ingest from the source

## Recommendation

Back up your Iceberg catalog regularly. The catalog is the single source of truth for pipeline state. Object storage data can always be re-created from source systems via re-load.
