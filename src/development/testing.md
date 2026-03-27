# Testing

## Run all tests

```bash
cargo test --workspace
```

## Test categories

- **Unit tests** — in each module's `#[cfg(test)]` block
- **Integration tests** — `crates/*/tests/*.rs`
- **Chaos tests** — `crates/datashuttle-flight/tests/chaos.rs`
- **Property tests** — `crates/datashuttle-flight/tests/proptest_buffer.rs`
- **Benchmarks** — `cargo bench -p datashuttle-core`, `cargo bench -p datashuttle-iceberg`

## CI

GitHub Actions runs on every push: `cargo fmt --check`, `cargo clippy`, `cargo test`.
