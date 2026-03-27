# Building from Source

```bash
cargo build                 # debug
cargo build --release       # optimized
cargo test --workspace      # all tests
cargo clippy -- -D warnings # lint
cargo doc --no-deps --open  # API docs

# UI
cd ui && npm install && npm run build
```
