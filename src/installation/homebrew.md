# Homebrew

Available on macOS and Linux via Homebrew.

## Install

```bash
brew tap datashuttle-io/tap
brew install datashuttle
```

The formula auto-updates with each GitHub release.

## First-run setup

`brew install` drops the binary but doesn't create the data directory
or bootstrap an admin user. Do that once before starting the service:

```bash
mkdir -p "$(brew --prefix)/var/datashuttle"
datashuttle setup --quickstart \
  --config "$(brew --prefix)/etc/datashuttle/datashuttle.yaml" \
  --data-dir "$(brew --prefix)/var/datashuttle"
```

## Run as a background service

```bash
brew services start datashuttle
```

The formula's `service` block sets `DS_DATA_DIR` to
`$(brew --prefix)/var/datashuttle` automatically — required because
the `/tmp` fallback was removed in #801.

Stop / restart / status:

```bash
brew services stop    datashuttle
brew services restart datashuttle
brew services info    datashuttle
```

## Run as a launchd daemon (production)

For a production install managed by `launchd` directly (rather than
via `brew services`), use the hardened plist shipped in the repo:

```bash
curl -LO https://raw.githubusercontent.com/datashuttle-io/datashuttle/main/packaging/launchd/ai.datashuttle.server.plist
sudo cp ai.datashuttle.server.plist /Library/LaunchDaemons/
sudo chown root:wheel /Library/LaunchDaemons/ai.datashuttle.server.plist
sudo chmod 644 /Library/LaunchDaemons/ai.datashuttle.server.plist
sudo launchctl load -w /Library/LaunchDaemons/ai.datashuttle.server.plist
```

The plist header documents the one-time `dscl` steps to create a
dedicated `_datashuttle` user with `NFSHomeDirectory=/var/lib/datashuttle`.

## Verify

```bash
datashuttle --version
datashuttle doctor --config "$(brew --prefix)/etc/datashuttle/datashuttle.yaml"
```

`datashuttle doctor` runs eight offline filesystem checks (config
parses, data dir is writable and not on tmpfs, crypto key mode 0600,
registry present, …) and prints a colour-coded summary.
