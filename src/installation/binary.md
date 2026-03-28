# Binary Download

Pre-built binaries for 5 platforms are attached to every [GitHub Release](https://github.com/evgenyestepanov-star/datashuttle/releases), each with a SHA256 checksum file.

## Available platforms

| Platform | Archive |
|----------|---------|
| Linux x86_64 | `datashuttle-x86_64-unknown-linux-gnu.tar.gz` |
| Linux ARM64 | `datashuttle-aarch64-unknown-linux-gnu.tar.gz` |
| macOS x86_64 | `datashuttle-x86_64-apple-darwin.tar.gz` |
| macOS ARM64 (Apple Silicon) | `datashuttle-aarch64-apple-darwin.tar.gz` |
| Windows x86_64 | `datashuttle-x86_64-pc-windows-msvc.zip` |

## Download and install

```bash
# Download binary + checksum
curl -LO https://github.com/evgenyestepanov-star/datashuttle/releases/latest/download/datashuttle-x86_64-unknown-linux-gnu.tar.gz
curl -LO https://github.com/evgenyestepanov-star/datashuttle/releases/latest/download/datashuttle-x86_64-unknown-linux-gnu.tar.gz.sha256

# Verify integrity
sha256sum -c datashuttle-x86_64-unknown-linux-gnu.tar.gz.sha256

# Extract and install
tar xzf datashuttle-x86_64-unknown-linux-gnu.tar.gz
sudo mv datashuttle /usr/local/bin/
```

## Verify

```bash
datashuttle --version
datashuttle --help
```
