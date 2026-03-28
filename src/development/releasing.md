# Release Process

Releases are fully automated. Pushing a semver tag triggers the [release workflow](https://github.com/evgenyestepanov-star/datashuttle/blob/main/.github/workflows/release.yaml).

## How to release

```bash
git tag v0.2.0
git push origin v0.2.0
```

## What CI does

1. **Verify** — runs `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`
2. **Build UI** — compiles the React app once, shares via artifact
3. **Cross-compile** — builds binaries for 5 targets:
   - `x86_64-unknown-linux-gnu`
   - `aarch64-unknown-linux-gnu`
   - `x86_64-apple-darwin`
   - `aarch64-apple-darwin`
   - `x86_64-pc-windows-msvc`
4. **Linux packages** — builds DEB and RPM via `cargo-deb` / `cargo-generate-rpm`
5. **Docker** — builds and pushes multi-arch image to `ghcr.io`
6. **GitHub Release** — generates changelog from conventional commits, attaches all artifacts + SHA256SUMS
7. **Homebrew** — updates the formula with new SHA256 checksums and commits to main

## Building locally

### Docker

```bash
# Single arch
docker build -f docker/Dockerfile -t datashuttle:local .

# Multi-arch (requires buildx)
docker buildx build -f docker/Dockerfile \
  --platform linux/amd64,linux/arm64 \
  -t datashuttle:local .
```

### DEB / RPM

```bash
cargo install cargo-deb cargo-generate-rpm --locked
cargo build --release --bin datashuttle
cargo deb --package datashuttle-cli --no-build
cargo generate-rpm --package crates/datashuttle-cli
```

### crates.io

```bash
# Publish in dependency order
cargo publish -p datashuttle-core
cargo publish -p datashuttle-iceberg
cargo publish -p datashuttle-cdc
cargo publish -p datashuttle-flight
cargo publish -p datashuttle-gossip
cargo publish -p datashuttle-ui
cargo publish -p datashuttle-api
cargo publish -p datashuttle-cli
```
