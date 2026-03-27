# GitOps

Store pipelines as SQL files in Git. Use `datashuttle apply/diff/validate` for CI/CD.

```bash
datashuttle validate -f pipelines/     # dry-run
datashuttle diff -f pipelines/         # show changes
datashuttle apply -f pipelines/        # apply
datashuttle apply -f pipelines/ --prune  # apply + remove orphans
```
