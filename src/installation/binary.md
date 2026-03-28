# Binary Download

The latest release is [**v0.1.0-alpha**](https://github.com/evgenyestepanov-star/datashuttle/releases/tag/v0.1.0-alpha).

Pre-built binaries are attached to every [GitHub Release](https://github.com/evgenyestepanov-star/datashuttle/releases), each with a SHA256 checksum file.

## Available platforms

| Platform | Archive |
|----------|---------|
| Linux x86_64 | `datashuttle-linux-amd64.tar.gz` |
| Linux ARM64 | `datashuttle-linux-arm64.tar.gz` |
| macOS ARM64 (Apple Silicon) | `datashuttle-macos-arm64.tar.gz` |

## Download and install

```bash
# Download binary + checksum
curl -LO https://github.com/evgenyestepanov-star/datashuttle/releases/latest/download/datashuttle-linux-amd64.tar.gz
curl -LO https://github.com/evgenyestepanov-star/datashuttle/releases/latest/download/datashuttle-linux-amd64.tar.gz.sha256

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
