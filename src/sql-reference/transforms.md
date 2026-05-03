# Transforms

DataShuttle provides SQL-native transforms powered by Apache DataFusion.
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
All DataFusion SQL is available: functions, CAST, WHERE, expressions.

## Legacy Syntax (Backward Compatible)

The following clauses still work and are translated to DataFusion SQL internally:

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

DataShuttle registers these UDFs in every transform context:

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

Adding a custom transform is a single Rust function + registration call:

```rust
use datafusion::prelude::*;
use datafusion::logical_expr::{ScalarUDF, ScalarUDFImpl, Signature, Volatility};

#[derive(Debug, Hash, PartialEq, Eq)]
struct MyUdf { signature: Signature }

impl ScalarUDFImpl for MyUdf {
    fn name(&self) -> &str { "my_func" }
    fn signature(&self) -> &Signature { &self.signature }
    fn return_type(&self, _: &[DataType]) -> Result<DataType> { Ok(DataType::Utf8) }
    fn invoke_with_args(&self, args: ScalarFunctionArgs) -> Result<ColumnarValue> {
        // Your logic here
        todo!()
    }
}

// Register it:
ctx.register_udf(ScalarUDF::from(MyUdf::new()));
```

No factory, no registry, no trait hierarchy. One function, one registration call.

## Architecture

```
Before (legacy):                     After (DataFusion):
Transform trait ─────────────────→   DELETED
TransformChain ──────────────────→   TransformShuttle (DataFusion SQL)
10 hand-written impls (~1500 LOC) →  6 UDFs + SQL (~300 LOC)
filter.rs (300+ LOC) ───────────→   DataFusion WHERE clause
```

All transforms run through DataFusion's query optimizer, getting free
type coercion, null handling, and expression optimization.
