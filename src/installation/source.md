# Building from Source

Build DataShuttle from the Git repository. This is primarily for contributors or users who need custom builds. For most users, [Docker](./docker.md) or [binary downloads](./binary.md) are faster.

## Prerequisites

- **Rust 1.82+** — install via [rustup](https://rustup.rs/)
- **Node.js 20+** — only needed if modifying the Web UI

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

## Verify

```bash
./target/release/datashuttle --version
```

## Contributing

For the full development setup — running tests, CI, project structure, and code standards — see the [Contributing Guide](https://github.com/evgenyestepanov-star/datashuttle/blob/main/docs/CONTRIBUTING.md).
