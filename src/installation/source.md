# Building from Source

Build DataShuttle from the Git repository.

## Prerequisites

- **Rust 1.82+** — install via [rustup](https://rustup.rs/)
- **Node.js 20+** — only needed if modifying the Web UI
- **Docker** — only needed for building container images

## Build the binary

```bash
git clone https://github.com/evgenyestepanov-star/datashuttle.git
cd datashuttle
cargo build --release
```

The release binary is at `target/release/datashuttle`.

## Build with the Web UI

The embedded Web UI is a React app compiled to static assets and bundled into the Rust binary via `rust-embed`:

```bash
cd ui
npm install
npm run build     # production build → ui/dist/
cd ..
cargo build --release   # picks up ui/dist/ automatically
```

For UI development with hot reload:

```bash
cd ui
npm run dev       # dev server with HMR on :5173
```

## Build the Docker image

```bash
# Single architecture
docker build -f docker/Dockerfile -t datashuttle:local .

# Multi-arch (requires Docker buildx)
docker buildx build -f docker/Dockerfile \
  --platform linux/amd64,linux/arm64 \
  -t datashuttle:local .
```

The multi-stage Dockerfile compiles the UI, builds the Rust binary, and produces a minimal Debian-slim image in one pass.

## Run tests

```bash
cargo test --workspace
cargo clippy -- -D warnings
cargo fmt --check
```

## Verify

```bash
./target/release/datashuttle --version
```

For full development setup (testing, CI, project structure), see the [Contributing Guide](https://github.com/evgenyestepanov-star/datashuttle/blob/main/docs/CONTRIBUTING.md).
