# Sinks and Hooks

## SinkConnector Trait

The `SinkConnector` trait abstracts the write destination. The initial
implementation wraps `IcebergWriter`; future sinks (Delta, Parquet, Kafka)
implement the same trait.

```rust
#[async_trait]
pub trait SinkConnector: Send + Sync {
    async fn open(&mut self, target: &str, schema: &SchemaRef) -> Result<(), SinkError>;
    async fn write_batch(&mut self, batch: RecordBatch) -> Result<SinkWriteResult, SinkError>;
    async fn commit(&mut self) -> Result<SinkCommitResult, SinkError>;
    async fn abort(&mut self) -> Result<(), SinkError>;
}
```

Lifecycle: `open()` -> `write_batch()` x N -> `commit()` -> repeat.

### How to Add a New Sink

1. Implement `SinkConnector` for your target system
2. Wire it into the shuttle builder

No factory, no registry. Just a trait and one implementation.

## ShuttleHook Trait

In-process hooks for lifecycle events: quality gates, audit logging,
circuit breakers.

```rust
#[async_trait]
pub trait ShuttleHook: Send + Sync {
    async fn on_start(&self, ctx: &ShuttleContext) -> Result<()> { Ok(()) }
    async fn after_transform(&self, ctx: &BatchContext, batch: &RecordBatch) -> Result<HookAction> {
        Ok(HookAction::Continue)
    }
    async fn on_commit(&self, ctx: &CommitContext) -> Result<()> { Ok(()) }
    async fn on_error(&self, ctx: &ErrorContext) -> Result<HookAction> {
        Ok(HookAction::Continue)
    }
}

pub enum HookAction { Continue, Skip, Abort }
```

Hooks are called in order. `Skip` drops the current batch, `Abort` stops
the shuttle. The existing webhook system is wrapped as `WebhookHook`.

### Hook Ordering

The `HookRunner` calls hooks in registration order. If any hook returns
`Abort`, subsequent hooks are not called and the shuttle stops.

### Built-in Hooks

- **WebhookHook** — wraps the existing HTTP webhook dispatcher
- Custom hooks implement `ShuttleHook` and are added to the runner
