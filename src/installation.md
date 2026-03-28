# Installation

DataShuttle ships as a single static binary with an embedded Web UI. Choose the method that fits your environment.

## Docker (recommended)

```bash
docker pull ghcr.io/evgenyestepanov-star/datashuttle:latest
docker run -p 8080:8080 ghcr.io/evgenyestepanov-star/datashuttle:latest
```

Multi-arch image supporting `linux/amd64` and `linux/arm64`. Built from a 3-stage Dockerfile (Node → Rust → Debian slim). Runs as non-root with `tini` as PID 1.

## Binary download

Pre-built binaries for 5 platforms with SHA256 checksums:

| Platform | Archive |
|----------|---------|
| Linux x86_64 | `datashuttle-x86_64-unknown-linux-gnu.tar.gz` |
| Linux ARM64 | `datashuttle-aarch64-unknown-linux-gnu.tar.gz` |
| macOS x86_64 | `datashuttle-x86_64-apple-darwin.tar.gz` |
| macOS ARM64 (Apple Silicon) | `datashuttle-aarch64-apple-darwin.tar.gz` |
| Windows x86_64 | `datashuttle-x86_64-pc-windows-msvc.zip` |

Download from [GitHub Releases](https://github.com/evgenyestepanov-star/datashuttle/releases):

```bash
curl -LO https://github.com/evgenyestepanov-star/datashuttle/releases/latest/download/datashuttle-x86_64-unknown-linux-gnu.tar.gz
curl -LO https://github.com/evgenyestepanov-star/datashuttle/releases/latest/download/datashuttle-x86_64-unknown-linux-gnu.tar.gz.sha256
sha256sum -c datashuttle-x86_64-unknown-linux-gnu.tar.gz.sha256
tar xzf datashuttle-x86_64-unknown-linux-gnu.tar.gz
sudo mv datashuttle /usr/local/bin/
datashuttle --version
```

## Homebrew (macOS / Linux)

```bash
brew tap evgenyestepanov-star/datashuttle
brew install datashuttle
```

The formula auto-updates with each release. To start as a background service:

```bash
brew services start datashuttle
```

## DEB package (Debian / Ubuntu)

```bash
sudo dpkg -i datashuttle_0.1.0_amd64.deb
sudo systemctl enable --now datashuttle
```

The DEB installs:
- Binary at `/usr/bin/datashuttle`
- systemd unit `datashuttle.service`
- Config directory at `/etc/datashuttle/`

## RPM package (RHEL / Fedora)

```bash
sudo rpm -i datashuttle-0.1.0-1.x86_64.rpm
```

## Cargo install

```bash
cargo install datashuttle-cli
```

Requires Rust 1.82+. Builds from source via crates.io.

## From source

```bash
git clone https://github.com/evgenyestepanov-star/datashuttle.git
cd datashuttle
cargo build --release
./target/release/datashuttle --version
```

See [Building from Source](./development/building.md) for details including UI compilation.

## Verify

After installation, verify DataShuttle is working:

```bash
datashuttle --version
datashuttle --help
```
