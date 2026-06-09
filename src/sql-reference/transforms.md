# Transforms

DataShuttle provides SQL-native transforms powered by a self-contained,
lightweight SQL engine (`sqlparser` + Apache Arrow compute — no DataFusion).
Transform your data inline as it flows from source to Iceberg.

## TRANSFORM AS

The `TRANSFORM AS (...)` clause replaces the legacy column-level transforms
(COLUMNS, EXCLUDE, MASK, ADD COLUMNS) with a single SQL expression:

```sql
CREATE SHUTTLE orders_masked
  SOURCE postgres CONNECTION prod_db
  TARGET iceberg.warehouse.orders
  TRANSFORM AS (
    SELECT
      id,
      mask(email, 'sha256') AS email,
      mask(phone, 'partial') AS phone,
      upper(name) AS name,
      CAST(amount AS DOUBLE) AS amount,
      ds_meta('timestamp') AS _ds_ingested_at,
      ds_hash(id, updated_at) AS _ds_row_hash
    FROM source
    WHERE deleted_at IS NULL
  )
  SCHEDULE EVERY '5 minutes';
```

The `source` table is a virtual table representing the incoming batch.
Transforms are **row-wise**: a projection (`SELECT` list) and an optional
`WHERE` filter over `source`. Supported: column references, literals, `CAST`
(`x::TYPE`), arithmetic/comparison/boolean operators, `IS [NULL]`, `CASE`,
and scalar function calls. Aggregates, `GROUP BY`, `JOIN`, window functions,
subqueries, and CTEs are intentionally **not** supported (use dbt/SQLMesh for
those).

A library of built-in scalar functions is available — string (`upper`,
`lower`, `trim`/`ltrim`/`rtrim`, `length`, `substr`, `concat`, `replace`),
conditional (`coalesce`, `nullif`), numeric (`abs`, `ceil`, `floor`, `round`,
`power`, `mod`), and datetime (`now`, `to_timestamp`, `date_part`) — plus the
custom UDFs below. New functions are easy to add (see *How to Add a New UDF*).

## Legacy Syntax (Backward Compatible)

The following clauses still work and are translated to SQL internally:

```sql
-- Column selection
CREATE SHUTTLE ... COLUMNS (id, name, email) ...

-- Column exclusion
CREATE SHUTTLE ... EXCLUDE (debug_data, internal_flag) ...

-- Type overrides
CREATE SHUTTLE ... WITH (type_overrides = '[["id", "BIGINT"]]') ...

-- WHERE filtering
CREATE SHUTTLE ... WHERE status != 'deleted' ...

-- PII masking
CREATE SHUTTLE ... MASK COLUMNS (email WITH SHA256, phone WITH PARTIAL) ...

-- Computed columns
CREATE SHUTTLE ... ADD COLUMNS (status = 'active', version = 1) ...
```

## Custom UDFs

DataShuttle registers these UDFs in every transform alongside the built-ins:

### mask(column, algorithm [, salt])

PII masking. Returns masked string.

| Algorithm | Example Output | Description |
|-----------|---------------|-------------|
| `sha256` | `a1b2c3d4...` (64 chars) | SHA-256 hash |
| `md5` | `a1b2c3d4...` (32 chars) | Truncated SHA-256 |
| `redact` | `***REDACTED***` | Full redaction |
| `partial` | `al**********om` | First 2 + last 2 visible |

```sql
SELECT mask(email, 'sha256') AS email FROM source
SELECT mask(email, 'sha256', 'my_secret_salt') AS email FROM source
```

### check_not_null(column)

Data quality gate. Passes the value through unchanged, but errors if any
row contains NULL.

```sql
SELECT check_not_null(order_id) AS order_id FROM source
```

### check_range(column, min, max)

Data quality gate. Passes the value through unchanged, but errors if any
value falls outside `[min, max]`.

```sql
SELECT check_range(amount, 0, 1000000) AS amount FROM source
```

### ds_meta(key)

Returns shuttle runtime metadata. Available keys:

| Key | Description |
|-----|-------------|
| `shuttle_name` | Name of the running shuttle |
| `table_name` | Current source table |
| `batch_id` | Unique ID for this batch |
| `timestamp` | Current UTC timestamp (RFC 3339) |
| `node_id` | DataShuttle cluster node ID |

```sql
SELECT *, ds_meta('shuttle_name') AS _ds_shuttle FROM source
```

### ds_hash(columns...)

Deterministic SHA-256 row hash across any number of columns. Useful for
deduplication and CDC change detection.

```sql
SELECT *, ds_hash(id, updated_at) AS _row_hash FROM source
```

## How to Add a New UDF

Implement the datafusion-free `ScalarFn` trait and register it — no DataFusion
types involved. The same trait powers the built-ins, the custom UDFs, and any
**external/caller-supplied** function (and is the seam for future
out-of-process / WASM functions):

```rust
use std::sync::Arc;
use arrow_array::{ArrayRef, StringArray};
use arrow_schema::DataType;
use datashuttle_core::transform::function::{
    FnRegistry, FnSignature, ScalarFn, Value,
};
use datashuttle_core::Result;

#[derive(Debug)]
struct MyUdf;

impl ScalarFn for MyUdf {
    fn name(&self) -> &str { "my_func" }
    fn signatures(&self) -> Vec<FnSignature> {
        vec![FnSignature::Exact(vec![DataType::Utf8])]
    }
    fn return_type(&self, _args: &[DataType]) -> Result<DataType> {
        Ok(DataType::Utf8)
    }
    fn invoke(&self, args: &[Value], n: usize) -> Result<ArrayRef> {
        // `args` are already coerced to a matching signature; `n` is the row
        // count so scalar-only calls can size their output. Return an ArrayRef.
        let _ = (args, n);
        Ok(Arc::new(StringArray::from(vec!["..."; n])))
    }
}

// Register via a registrar handed to `TransformShuttle::with_udfs`:
let registrar = Arc::new(|reg: &mut FnRegistry| {
    reg.insert("my_func".into(), Arc::new(MyUdf));
});
```

No factory, no trait hierarchy, no DataFusion. One trait impl, one insert.

## Architecture

```
Before (legacy):                     Now (self-contained, datafusion-free):
Transform trait ─────────────────→   DELETED
TransformChain ──────────────────→   TransformShuttle (sqlparser → arrow)
10 hand-written impls (~1500 LOC) →  built-ins + 5 UDFs (ScalarFn) + SQL
filter.rs (300+ LOC) ───────────→   WHERE clause → arrow::compute::filter
```

The engine parses SQL with `sqlparser`, binds it to a typed expression IR
(resolving columns/types and applying coercion), and evaluates directly via
`arrow::compute` kernels. DataFusion was removed in 2026-06.
