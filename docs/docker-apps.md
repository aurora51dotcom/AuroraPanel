# Docker apps

**Applications → Docker Apps** installs self-hosted apps in containers: Home Assistant, Jellyfin,
Vaultwarden, Uptime Kuma, Pi-hole, AdGuard Home, Gitea, n8n, File Browser, Syncthing, Navidrome,
Grafana, code-server, Portainer and Mosquitto. Docker itself is installed on first use.

Each app lives in `/opt/aurora-apps/<name>/` (a `docker-compose.yml` plus its data), so it can also
be managed by hand.

## Who can reach it

Docker publishes ports by writing its own firewall rules, which skip `ufw` and the panel's ban
list. So containers are **private by default**:

| Access | Meaning |
| ------ | ------- |
| **Private (through a website)** | The app listens on `127.0.0.1` only. AuroraPanel creates an Apache site (e.g. `kuma.example.com`) that proxies to it, with WebSockets. HTTPS comes from AutoSSL, and the WAF and IP bans apply. Recommended. |
| **Local network** | The app listens only on this machine's private LAN address — reachable from your network, not from the internet. |
| **Public port** | Its port is open to everyone, bypassing the firewall. Possible, but flagged — only for apps meant to be public. |

AuroraPanel also lets VPN clients reach apps, so the built-in WireGuard/OpenVPN works for them.

## Managing

Start, stop, restart, update (pull the newest image), logs and remove (optionally with its data).
Container logs are size-limited so they can't fill the disk.
