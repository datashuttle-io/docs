# DEB / RPM Packages

Native Linux packages are attached to each [GitHub Release](https://github.com/datashuttle-io/datashuttle/releases).

## Debian / Ubuntu

```bash
sudo dpkg -i datashuttle_0.1.0_amd64.deb
sudo systemctl enable --now datashuttle
```

The DEB package installs:

| Path | Content |
|------|---------|
| `/usr/bin/datashuttle` | Binary |
| `/etc/datashuttle/` | Configuration directory |
| `datashuttle.service` | systemd unit (auto-enabled) |

## RHEL / Fedora

```bash
sudo rpm -i datashuttle-0.1.0-1.x86_64.rpm
```

## Managing the service

```bash
sudo systemctl status datashuttle
sudo systemctl restart datashuttle
journalctl -u datashuttle -f
```

Edit `/etc/datashuttle/datashuttle.yaml` before starting. See [Configuration](../concepts/configuration.md) for all options.
