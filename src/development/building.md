# Building from Source

## Prerequisites

- **Rust 1.82+** — install via [rustup](https://rustup.rs/)
- **Node.js 20+** — only needed to modify the Web UI
- **Docker** — for building container images

## Rust binary

```bash
cargo build                 # debug
cargo build --release       # optimized
cargo test --workspace      # all tests
cargo clippy -- -D warnings # lint
cargo doc --no-deps --open  # API docs
```

The release binary is at `target/release/datashuttle`.

## Web UI

The embedded Web UI is a React app compiled to static assets and bundled into the binary via `rust-embed`:

```bash
cd ui
npm install
npm run dev     # dev server with HMR on :5173
npm run build   # production build → ui/dist/
```

For production builds, compile the UI first — `cargo build` picks up `ui/dist/` automatically.

## Docker image

The multi-stage Dockerfile builds UI, Rust binary, and runtime image in one pass:

```bash
# Single arch
docker build -f docker/Dockerfile -t datashuttle:local .

# Multi-arch (requires buildx)
docker buildx build -f docker/Dockerfile \
  --platform linux/amd64,linux/arm64 \
  -t datashuttle:local .
```

## Linux packages

DEB and RPM packages are built from metadata in `crates/datashuttle-cli/Cargo.toml`:

```bash
cargo install cargo-deb cargo-generate-rpm --locked
cargo build --release --bin datashuttle

# DEB (Debian/Ubuntu)
cargo deb --package datashuttle-cli --no-build

# RPM (RHEL/Fedora)
cargo generate-rpm --package crates/datashuttle-cli
```

Output lands in `target/debian/` and `target/generate-rpm/` respectively.
