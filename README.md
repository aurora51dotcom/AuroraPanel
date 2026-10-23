# AuroraPanel

A lightweight web hosting control panel for **Raspberry Pi** (and any Linux
box), laid out like cPanel: system monitoring, your own VPN server, websites,
databases, fail2ban, FTP, backups, Git and more — all from your browser.

Built with **FastAPI** (Python) + a dependency-free **vanilla JS** frontend, so
there's nothing to compile on the Pi.

**Version: Beta v1.0.16** (`1.0.16-beta`) — a free, open-source hobby project (MIT License). Website: https://aurora51.com

To update, open **Preferences → About & Updates → Check for updates** in the panel (it only contacts
aurora51.com when you click), or re-download the zip, unzip it over your install and re-run `sudo bash install.sh`.

**Feedback, bugs and ideas:** please share them in the
[Reddit thread](https://www.reddit.com/r/RASPBERRY_PI_PROJECTS/comments/1ws2int/made_a_web_control_panel_for_raspberry_pi_and/)
or the [Raspberry Pi Forums thread](https://forums.raspberrypi.com/viewtopic.php?p=2388892).

## Features

| Section | What it does |
| ------- | ------------ |
| **System** | Live dashboard (CPU, per-core load, temperature, throttling, memory, disks, uptime), `systemd` services, processes, `apt` packages, `ufw` firewall (with lock-out protection), Linux users. |
| **Network** | VPN servers — **WireGuard** (QR codes), **OpenVPN** (per-user logins: certificate + password, password only or certificate only) and **IPsec/IKEv2** (native on iPhone/Mac/Windows) — each with an end-to-end self-test. Dynamic DNS (DuckDNS, No-IP, Dynu, deSEC, Cloudflare, FreeDNS, custom). Port Checker (outside probe, double-NAT/CGNAT detection, router instructions, UPnP). Network Monitor (who tried to connect). IP Blocker & Trust (ban IPs/ranges with expiry, trusted list). Fail2ban. Interfaces & Wi-Fi with confirm-or-revert. |
| **Databases** | MariaDB and PostgreSQL databases and users, wizards, phpMyAdmin link. |
| **Domains** | Apache virtual hosts (Force HTTPS, Let's Encrypt), folder sites at `http://<pi-ip>/<name>` (no domain needed), redirects, BIND zone editor. |
| **Security** | fail2ban jails (SSH, panel, OpenVPN, FTP, Apache, Nginx, MariaDB, port scans, repeat offenders), SSH keys, SSL/TLS, ModSecurity, hotlink protection, API tokens, TOTP two-factor login, panel HTTPS. |
| **Files** | File manager (upload, edit, zip, recycle bin), Images (thumbnails, resize, WebP), Directory Privacy (password-protected folders), Disk & Inodes usage, Web Disk (WebDAV), FTP accounts (locked to a folder; full / read-only / upload-only), Backups (folders, single databases, upload & import `.sql` dumps, categories, live progress bars, several restores at once) + Backup Wizard (files and databases, selective restore), Git Version Control (clone, pull, deploy, deploy keys). |
| **Advanced** | Browser terminal, cron wizard, `.htaccess` tools, ClamAV virus scanner, DNS tracing. |
| **Software** | One-click Apache / Nginx / Lighttpd / Caddy / PHP-FPM / MariaDB / vsftpd, each with a settings page, config editor (validated, auto-rollback) and logs; PHP settings and extensions; App Manager. |
| **App Installer** | Softaculous-style catalog of 40+ web apps in 18 categories (WordPress, Joomla, Drupal, phpBB, MediaWiki, Nextcloud, Moodle, OpenCart, Roundcube, Matomo, Laravel, Symfony…). Pick an app, choose Local / IP / domain / subdomain / existing site / any folder, and it downloads the latest release (checksum-verified where published), creates the database and — for apps with a command-line installer — sets up the admin account too, with a live progress bar. |

Auth is a single admin account (PBKDF2-hashed password, signed 8-hour session
cookies), with optional TOTP 2FA. First launch walks you through creating the
account. Most system actions require the panel to run as **root** (the systemd
unit does); features degrade gracefully where a tool (`ufw`, `systemctl`) is
absent.

## Quick start (development, Windows or Linux)

```bash
# Linux / macOS / Pi
./run.sh

# Windows
run.bat
```

Then open **http://localhost:8088** (dev) — on the first run you'll create your
admin username + password.

The scripts create a `.venv`, install `requirements.txt`, and start Uvicorn.

## Installing on a Raspberry Pi

Works on any Raspberry Pi running Raspberry Pi OS Bookworm or newer (or any
Debian/Ubuntu with systemd and Python 3.10+), under any user name.

```bash
git clone <your-repo> ~/AuroraPanel   # or copy the folder over
cd ~/AuroraPanel
sudo bash install.sh
```

The installer asks which port to use (default `8088`), installs the needed
packages, creates `.venv`, and sets up a `aurorapanel` systemd service that
starts on boot. It then prints the URLs to open, e.g. `http://<pi-ip>:8088`.

| Command | What it does |
| ------- | ------------ |
| `sudo bash install.sh` | Interactive install (prompts for port) |
| `sudo bash install.sh --port 9000` | Non-interactive install on port 9000 |
| `sudo bash install.sh` (again) | Change the port / repair; keeps your admin account |
| `sudo bash install.sh --uninstall` | Remove AuroraPanel completely (asks first; add `--yes` to skip the question) |

If `ufw` is active, the chosen port is allowed automatically. The panel runs as
**root** so it can control services and read privileged files;
`deploy/aurorapanel.service` is a reference unit for manual installs.

## Configuration

Environment variables (set them before launch or in the systemd unit):

| Var | Default | Meaning |
| --- | ------- | ------- |
| `HOST` | `0.0.0.0` (Linux) / `127.0.0.1` (Win) | Bind address |
| `PORT` | `8088` | Bind port |
| `AURORA_USER` | user who ran `install.sh` | The Pi's regular login (default home, protected from deletion) |
| `AURORA_FILE_ROOT` | not set (whole Pi; opens in the web root) | Confine the File Manager to this one folder |

Credentials are stored in `aurora_config.json` (git-ignored). Delete that file
to re-run first-time setup.

## Security notes

- **Turn on Panel HTTPS** (Security page) so your password and session cookie
  are encrypted on the network. It uses a self-signed certificate (or a Let's
  Encrypt one you already have) and switches back to HTTP by itself if the
  browser doesn't reach the new https:// address within 3 minutes.
- **Put it behind your LAN / VPN.** Reach it from outside through the built-in
  WireGuard/OpenVPN server rather than forwarding the panel port.
- Failed logins are throttled per IP (10 per 15 minutes) on top of fail2ban;
  changing the password or turning on 2FA signs out every other session.
- A strict Content-Security-Policy is sent with every page, and untrusted text
  (log lines, usernames from failed logins) is only ever rendered as text.
- The file manager opens in the web folder and can browse the whole Pi (like the root Terminal);
  set `AURORA_FILE_ROOT` to confine it to one folder (it then rejects `..`/symlink escapes). It
  refuses to delete `/`, top-level system folders, home folders and website folders. Service
  names are validated before being passed to `systemctl`.
- Sessions are HttpOnly, SameSite=strict cookies signed with a per-install
  secret that rotates whenever the password changes.

## Testing

Tests live in `tests/` (pytest, with a coverage report). They use a throwaway login, config and
File Manager folder, and only call read-only pages, so they never change your Pi.

| Where | Command | What it checks |
|---|---|---|
| On a Pi (recommended) | `sudo bash tests/run.sh` | Everything, against the real system: every page loads without crashing, login and sessions, File Manager safety, Apache site rules |
| Any computer | `pip install -r requirements-dev.txt && python -m pytest` | Same, minus the Linux-only parts (skipped on Windows/macOS) |
| GitHub | automatic on every push | Same suite on Ubuntu; the coverage report is attached to each run |

Open `htmlcov/index.html` afterwards to see which lines the tests reached. Run one area with
`-k`, e.g. `sudo bash tests/run.sh -k sites`.

## Project layout

```
AuroraPanel/
├─ backend/
│  ├─ app.py          # FastAPI app + routes
│  ├─ auth.py         # signed session tokens
│  ├─ config.py       # credential storage (PBKDF2)
│  ├─ system_info.py  # psutil metrics + Pi extras
│  ├─ services.py     # systemctl control
│  └─ files.py        # sandboxed file manager
├─ frontend/          # index.html + css/ + js/  (static, no build)
├─ deploy/aurorapanel.service
├─ requirements.txt
├─ run.sh / run.bat
└─ README.md
```

## License

AuroraPanel is released under the [MIT License](LICENSE). You're free to use,
modify and share it. It comes as-is, without warranty.

## Trademarks

cPanel is a registered trademark of cPanel, L.L.C. Raspberry Pi is a trademark of
Raspberry Pi Ltd. AuroraPanel is an independent project and is not affiliated with
or endorsed by either company. All other names are trademarks of their respective owners.
