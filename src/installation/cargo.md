# Cargo Install

Install directly from crates.io. Requires **Rust 1.82+**.

## Install

```bash
cargo install datashuttle-cli
```

This builds and installs the `datashuttle` binary to `~/.cargo/bin/`.

## Verify

```bash
datashuttle --version
```

> **Note:** The cargo install includes the embedded Web UI (pre-compiled assets are bundled in the crate). You don't need Node.js.
