# Binary Download

Pre-built binaries are attached to every [GitHub Release](https://github.com/datashuttle-ai/datashuttle/releases), each with a SHA256 checksum file.

## Quick install (recommended)

The install script detects your OS and architecture, downloads the binary, verifies the checksum, and installs to `/usr/local/bin`:

```bash
curl -fsSL https://raw.githubusercontent.com/datashuttle-ai/datashuttle/main/install.sh | bash
```

### Options

```bash
# Install a specific version
curl -fsSL ... | bash -s -- --version v0.1.0

# Install to a custom directory
curl -fsSL ... | bash -s -- --install-dir ~/.local/bin

# Or set via environment variables
DATASHUTTLE_VERSION=v0.1.0 DATASHUTTLE_INSTALL_DIR=~/.local/bin bash install.sh
```

## Available platforms

| Platform | Archive |
|----------|---------|
| Linux x86_64 | `datashuttle-linux-amd64.tar.gz` |
| Linux ARM64 | `datashuttle-linux-arm64.tar.gz` |
| macOS ARM64 (Apple Silicon) | `datashuttle-macos-arm64.tar.gz` |

## Manual download and install

```bash
# Download binary + checksum
curl -LO https://github.com/datashuttle-ai/datashuttle/releases/latest/download/datashuttle-linux-amd64.tar.gz
curl -LO https://github.com/datashuttle-ai/datashuttle/releases/latest/download/datashuttle-linux-amd64.tar.gz.sha256

# Verify integrity
sha256sum -c datashuttle-linux-amd64.tar.gz.sha256

# Extract and install
tar xzf datashuttle-linux-amd64.tar.gz
sudo mv datashuttle /usr/local/bin/
```

## Verify

```bash
datashuttle --version
datashuttle --help
```
