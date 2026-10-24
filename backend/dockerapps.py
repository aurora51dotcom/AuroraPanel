"""Docker apps — one-click self-hosted apps (Home Assistant, Jellyfin, Vaultwarden, Uptime Kuma…).

Every app lives in /opt/aurora-apps/<name>/ (docker-compose.yml + its data), run with `docker compose`.

Safety first: Docker publishes ports by writing its own firewall rules, which skip ufw *and* this
panel's ban list. So by default an app only listens on 127.0.0.1 and is reached through a web address
(an Apache reverse proxy site: HTTPS from AutoSSL, the WAF and IP bans apply). "Local network" binds
to this machine's private LAN address only; "public port" is possible but flagged.
"""
from __future__ import annotations

import ipaddress
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import time
from pathlib import Path

from . import jobs

BASE = Path("/opt/aurora-apps")
PATH = "/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/bin"
_NAME = re.compile(r"^[a-z][a-z0-9-]{1,30}$")


class DockerError(RuntimeError):
    pass


# id: name, category, description, image, ports [(container port, proto, kind)], volumes [(container path, folder)],
# env {k: v ("{secret}" = generated)}, ram, extra compose keys. kind: web = the app's web page; tcp/udp = other ports.
CATALOG: dict[str, dict] = {
    "homeassistant": {"name": "Home Assistant", "cat": "Home", "desc": "Open-source home automation: lights, sensors, energy, cameras — 3,000+ integrations, runs locally.",
                      "image": "ghcr.io/home-assistant/home-assistant:stable", "ports": [(8123, "tcp", "web")], "volumes": [("/config", "config")],
                      "env": {"TZ": "{tz}"}, "ram": "≈ 300 MB", "host_network": True, "privileged": True, "home": "https://www.home-assistant.io"},
    "jellyfin": {"name": "Jellyfin", "cat": "Media", "desc": "Your own Netflix: stream your movies, shows and music to any device. No account, no tracking.",
                 "image": "jellyfin/jellyfin:latest", "ports": [(8096, "tcp", "web")], "volumes": [("/config", "config"), ("/cache", "cache"), ("/media", "@media")],
                 "env": {}, "ram": "≈ 250 MB", "home": "https://jellyfin.org"},
    "vaultwarden": {"name": "Vaultwarden", "cat": "Security", "desc": "Password manager compatible with the Bitwarden apps and browser extensions.",
                    "image": "vaultwarden/server:latest", "ports": [(80, "tcp", "web")], "volumes": [("/data", "data")],
                    "env": {"ADMIN_TOKEN": "{secret}", "SIGNUPS_ALLOWED": "true", "WEBSOCKET_ENABLED": "true"}, "ram": "≈ 30 MB", "https_only": True,
                    "note": "Needs a web address with HTTPS (the Bitwarden apps refuse plain http). Turn sign-ups off in its admin page (/admin) once your account exists.",
                    "home": "https://github.com/dani-garcia/vaultwarden"},
    "uptimekuma": {"name": "Uptime Kuma", "cat": "Monitoring", "desc": "Watch your websites and services; get notified the moment one goes down.",
                   "image": "louislam/uptime-kuma:1", "ports": [(3001, "tcp", "web")], "volumes": [("/app/data", "data")], "env": {}, "ram": "≈ 100 MB",
                   "home": "https://uptime.kuma.pet"},
    "pihole": {"name": "Pi-hole", "cat": "Network", "desc": "Network-wide ad and tracker blocking: point your router's DNS at it and every device is covered.",
               "image": "pihole/pihole:latest", "ports": [(80, "tcp", "web"), (53, "tcp", "dns"), (53, "udp", "dns")],
               "volumes": [("/etc/pihole", "etc-pihole"), ("/etc/dnsmasq.d", "dnsmasq")],
               "env": {"TZ": "{tz}", "FTLCONF_webserver_api_password": "{secret}", "FTLCONF_dns_listeningMode": "all"}, "ram": "≈ 80 MB",
               "note": "Needs port 53 — it can't run next to this server's own DNS server (BIND). The admin password is shown after install.",
               "home": "https://pi-hole.net"},
    "adguard": {"name": "AdGuard Home", "cat": "Network", "desc": "Ad blocking DNS with encrypted DNS (DoH/DoT), parental controls and a clean interface.",
                "image": "adguard/adguardhome:latest", "ports": [(3000, "tcp", "web"), (53, "tcp", "dns"), (53, "udp", "dns")],
                "volumes": [("/opt/adguardhome/work", "work"), ("/opt/adguardhome/conf", "conf")], "env": {}, "ram": "≈ 50 MB",
                "note": "Needs port 53, so not next to this server's own DNS server (BIND).", "home": "https://adguard.com/adguard-home.html"},
    "gitea": {"name": "Gitea", "cat": "Development", "desc": "Your own GitHub: Git hosting with pull requests, issues, wiki and CI.",
              "image": "gitea/gitea:latest", "ports": [(3000, "tcp", "web"), (22, "tcp", "ssh")], "volumes": [("/data", "data")],
              "env": {"USER_UID": "1000", "USER_GID": "1000"}, "ram": "≈ 150 MB", "home": "https://about.gitea.com"},
    "n8n": {"name": "n8n", "cat": "Automation", "desc": "Visual workflow automation (like Zapier) with 400+ integrations and AI steps.",
            "image": "n8nio/n8n:latest", "ports": [(5678, "tcp", "web")], "volumes": [("/home/node/.n8n", "data")],
            "env": {"TZ": "{tz}", "GENERIC_TIMEZONE": "{tz}", "N8N_SECURE_COOKIE": "{secure}", "N8N_PROXY_HOPS": "1"}, "ram": "≈ 250 MB", "home": "https://n8n.io"},
    "filebrowser": {"name": "File Browser", "cat": "Files", "desc": "A simple web file manager to share and upload files from any browser.",
                    "image": "filebrowser/filebrowser:latest", "ports": [(80, "tcp", "web")], "volumes": [("/srv", "@files"), ("/database", "db"), ("/config", "config")],
                    "env": {}, "ram": "≈ 20 MB", "note": "First login: admin — the password is printed in the app's log on first start (Logs).",
                    "home": "https://filebrowser.org"},
    "syncthing": {"name": "Syncthing", "cat": "Files", "desc": "Keep folders in sync between your computers and phones — peer to peer, no cloud.",
                  "image": "syncthing/syncthing:latest", "ports": [(8384, "tcp", "web"), (22000, "tcp", "sync"), (22000, "udp", "sync"), (21027, "udp", "discovery")],
                  "volumes": [("/var/syncthing", "data")], "env": {"PUID": "1000", "PGID": "1000"}, "ram": "≈ 60 MB", "home": "https://syncthing.net"},
    "navidrome": {"name": "Navidrome", "cat": "Media", "desc": "Your music collection, streamed anywhere — works with Subsonic apps on every phone.",
                  "image": "deluan/navidrome:latest", "ports": [(4533, "tcp", "web")], "volumes": [("/data", "data"), ("/music", "@music")],
                  "env": {}, "ram": "≈ 40 MB", "home": "https://www.navidrome.org"},
    "grafana": {"name": "Grafana", "cat": "Monitoring", "desc": "Beautiful dashboards for metrics from Prometheus, InfluxDB, Home Assistant and more.",
                "image": "grafana/grafana-oss:latest", "ports": [(3000, "tcp", "web")], "volumes": [("/var/lib/grafana", "data")],
                "env": {"GF_SECURITY_ADMIN_PASSWORD": "{secret}"}, "ram": "≈ 100 MB", "user": "0", "home": "https://grafana.com"},
    "codeserver": {"name": "VS Code (code-server)", "cat": "Development", "desc": "Visual Studio Code in your browser, running on this server.",
                   "image": "lscr.io/linuxserver/code-server:latest", "ports": [(8443, "tcp", "web")], "volumes": [("/config", "config")],
                   "env": {"PUID": "1000", "PGID": "1000", "TZ": "{tz}", "PASSWORD": "{secret}"}, "ram": "≈ 200 MB", "home": "https://coder.com/docs/code-server"},
    "portainer": {"name": "Portainer", "cat": "Development", "desc": "Advanced Docker management: containers, images, volumes, networks and stacks.",
                  "image": "portainer/portainer-ce:latest", "ports": [(9000, "tcp", "web")], "volumes": [("/data", "data"), ("/var/run/docker.sock", "!/var/run/docker.sock")],
                  "env": {}, "ram": "≈ 40 MB", "home": "https://www.portainer.io"},
    "mosquitto": {"name": "Mosquitto (MQTT)", "cat": "Home", "desc": "The MQTT message broker sensors, Zigbee2MQTT, Tasmota and Home Assistant talk through.",
                  "image": "eclipse-mosquitto:2", "ports": [(1883, "tcp", "mqtt")], "volumes": [("/mosquitto/config", "config"), ("/mosquitto/data", "data")],
                  "env": {}, "ram": "≈ 5 MB", "no_web": True, "home": "https://mosquitto.org",
                  "files": {"config/mosquitto.conf": "listener 1883\nallow_anonymous false\npassword_file /mosquitto/config/passwd\npersistence true\npersistence_location /mosquitto/data/\n"},
                  "note": "Add users with: docker exec -it <app> mosquitto_passwd -b /mosquitto/config/passwd USER PASSWORD, then Restart."},
}


def _env() -> dict:
    return {**os.environ, "PATH": PATH}


def _run(argv, timeout=300, cwd=None):
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=timeout, env=_env(), cwd=cwd)
    except (OSError, subprocess.TimeoutExpired) as e:
        return subprocess.CompletedProcess(argv, 1, "", str(e))


def compose_cmd() -> list[str] | None:
    if shutil.which("docker", path=PATH) and _run(["docker", "compose", "version"], 20).returncode == 0:
        return ["docker", "compose"]
    if shutil.which("docker-compose", path=PATH):
        return ["docker-compose"]
    return None


def installed() -> bool:
    return shutil.which("docker", path=PATH) is not None and compose_cmd() is not None


def daemon_ok() -> bool:
    return _run(["docker", "info", "--format", "{{.ServerVersion}}"], 20).returncode == 0


def post_install() -> list[str]:
    """Log size limits (SD cards!) and start Docker."""
    daemon = Path("/etc/docker/daemon.json")
    try:
        cfg = json.loads(daemon.read_text()) if daemon.exists() else {}
    except ValueError:
        cfg = {}
    cfg.setdefault("log-driver", "json-file")
    cfg.setdefault("log-opts", {"max-size": "10m", "max-file": "3"})
    daemon.parent.mkdir(parents=True, exist_ok=True)
    daemon.write_text(json.dumps(cfg, indent=2) + "\n")
    # Docker turns the kernel's FORWARD policy to DROP, which would cut off VPN clients (WireGuard, OpenVPN,
    # IPsec) routed through this server. Let their traffic through Docker's own hook, every time Docker starts.
    rules = [["-i", "wg+"], ["-o", "wg+"], ["-i", "tun+"], ["-o", "tun+"],
             ["-m", "policy", "--dir", "in", "--pol", "ipsec"], ["-m", "policy", "--dir", "out", "--pol", "ipsec"]]
    pre = "\n".join(f"ExecStart=-/bin/sh -c 'iptables -C DOCKER-USER {' '.join(r)} -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER {' '.join(r)} -j ACCEPT'"
                    for r in rules)
    Path("/etc/systemd/system/aurora-docker-vpn.service").write_text(
        "# Written by AuroraPanel: keep VPN clients routed when Docker is installed\n"
        "[Unit]\nDescription=AuroraPanel: let VPN traffic past Docker's forward filter\nAfter=docker.service\nBindsTo=docker.service\n\n"
        f"[Service]\nType=oneshot\nRemainAfterExit=yes\n{pre}\n\n[Install]\nWantedBy=docker.service\n")
    _run(["systemctl", "daemon-reload"], 60)
    _run(["systemctl", "enable", "docker", "aurora-docker-vpn"], 60)
    _run(["systemctl", "restart", "docker"], 120)
    _run(["systemctl", "start", "aurora-docker-vpn"], 60)
    BASE.mkdir(parents=True, exist_ok=True)
    os.chmod(BASE, 0o711)
    return ["• Docker started; container logs are capped at 10 MB × 3 so they can't fill the disk",
            "• VPN clients keep working (Docker's forward filter lets WireGuard/OpenVPN/IPsec traffic through)"]


def arch() -> str:
    return {"x86_64": "amd64", "aarch64": "arm64", "armv7l": "arm", "armv6l": "arm"}.get(os.uname().machine, os.uname().machine)


def _lan_ip() -> str:
    try:
        import psutil
        for name, addrs in psutil.net_if_addrs().items():
            if name.startswith(("docker", "br-", "veth", "lo", "wg", "tun")):
                continue
            for a in addrs:
                if a.family == socket.AF_INET:
                    ip = ipaddress.ip_address(a.address)
                    if ip.is_private and not ip.is_loopback:
                        return a.address
    except Exception:
        pass
    return ""


def _port_free(port: int, proto: str = "tcp") -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM if proto == "tcp" else socket.SOCK_DGRAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("0.0.0.0", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def _free_port(start: int) -> int:
    used = {p for a in _state()["apps"].values() for p in a.get("host_ports", {}).values()}
    p = max(start, 10000)
    while p in used or not _port_free(p):
        p += 1
    return p


STATE = Path("/var/lib/aurora/docker-apps.json")


def _state() -> dict:
    try:
        d = json.loads(STATE.read_text())
    except (OSError, ValueError):
        d = {}
    d.setdefault("apps", {})
    return d


def _save(d: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_name(f".{STATE.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(d, indent=1))
    os.chmod(tmp, 0o600)  # holds generated app passwords
    tmp.replace(STATE)


def _tz() -> str:
    try:
        return Path("/etc/timezone").read_text().strip() or "UTC"
    except OSError:
        link = os.path.realpath("/etc/localtime")
        return link.split("zoneinfo/")[-1] if "zoneinfo/" in link else "UTC"


def _yaml_str(v) -> str:
    return json.dumps(str(v))  # JSON strings are valid YAML scalars


def render_compose(name: str, app: dict, inst: dict) -> str:
    lines = ["# Written by AuroraPanel (Applications → Docker Apps). Edit there — changes here are overwritten.", "services:", f"  {name}:",
             f"    image: {_yaml_str(inst.get('image') or app['image'])}", f"    container_name: {_yaml_str(name)}", "    restart: unless-stopped"]
    if app.get("host_network"):
        lines.append("    network_mode: host")
    if app.get("privileged"):
        lines.append("    privileged: true")
    if app.get("user"):
        lines.append(f"    user: {_yaml_str(app['user'])}")
    if not app.get("host_network"):
        ports = []
        for (cport, proto, kind) in app["ports"]:
            hp = inst["host_ports"].get(f"{cport}/{proto}")
            if not hp:
                continue
            bind = "127.0.0.1" if inst["access"] == "proxy" and kind == "web" else (inst.get("lan_ip") if inst["access"] == "lan" else "0.0.0.0")
            if kind in ("dns",) and inst["access"] != "proxy":
                bind = inst.get("lan_ip") or "0.0.0.0"
            elif kind != "web" and inst["access"] == "proxy":
                bind = inst.get("lan_ip") or "127.0.0.1"
            ports.append(f"      - {_yaml_str(f'{bind}:{hp}:{cport}/{proto}')}")
        if ports:
            lines += ["    ports:"] + ports
    vols = []
    for cpath, folder in app["volumes"]:
        if folder.startswith("!"):
            host = folder[1:]
        elif folder.startswith("@"):
            host = inst["folders"].get(folder[1:]) or str(BASE / name / folder[1:])
        else:
            host = str(BASE / name / folder)
        vols.append(f"      - {_yaml_str(f'{host}:{cpath}')}")
    if vols:
        lines += ["    volumes:"] + vols
    if inst["env"]:
        lines += ["    environment:"] + [f"      {k}: {_yaml_str(v)}" for k, v in inst["env"].items()]
    lines += ["    logging:", "      driver: json-file", "      options:", '        max-size: "10m"', '        max-file: "3"',
              "    labels:", f"      aurora.app: {_yaml_str(inst['app'])}"]
    return "\n".join(lines) + "\n"


def catalog() -> dict:
    return {"catalog": [{"id": k, **{x: v.get(x) for x in ("name", "cat", "desc", "ram", "note", "home", "https_only", "no_web", "host_network")},
                      "ports": [{"port": p, "proto": pr, "kind": k2} for p, pr, k2 in v["ports"]],
                      "folders": [f[1:] for _, f in v["volumes"] if f.startswith("@")]} for k, v in CATALOG.items()],
            "installed": installed(), "running": daemon_ok() if installed() else False, "arch": arch(), "lan_ip": _lan_ip(),
            "bind9": shutil.which("named", path=PATH) is not None}


def listing() -> dict:
    d = _state()
    out = []
    ps = {}
    stats = {}
    if installed():
        r = _run(["docker", "ps", "-a", "--format", "{{json .}}"], 30)
        for line in r.stdout.splitlines():
            try:
                c = json.loads(line)
                ps[c["Names"]] = c
            except (ValueError, KeyError):
                pass
        r = _run(["docker", "stats", "--no-stream", "--format", "{{json .}}"], 30)
        for line in r.stdout.splitlines():
            try:
                c = json.loads(line)
                stats[c["Name"]] = c
            except (ValueError, KeyError):
                pass
    for name, inst in d["apps"].items():
        c = ps.get(name, {})
        st = stats.get(name, {})
        app = CATALOG.get(inst["app"], {})
        out.append({"name": name, "app": inst["app"], "title": app.get("name", inst["app"]), "access": inst["access"], "domain": inst.get("domain", ""),
                    "url": _url(inst, app), "state": c.get("State", "missing"), "status": c.get("Status", ""), "image": c.get("Image", inst.get("image") or app.get("image", "")),
                    "cpu": st.get("CPUPerc", ""), "mem": st.get("MemUsage", ""), "created": inst.get("created"),
                    "ports": inst.get("host_ports", {}), "secrets": sorted(k for k, v in inst.get("env", {}).items() if k in inst.get("secret_keys", [])),
                    "note": app.get("note", "")})
    return {"apps": sorted(out, key=lambda a: a["name"]), "installed": installed(), "running": daemon_ok() if installed() else False,
            "disk": _disk_usage() if installed() else None}


def _disk_usage() -> dict:
    r = _run(["docker", "system", "df", "--format", "{{json .}}"], 60)
    out = {}
    for line in r.stdout.splitlines():
        try:
            x = json.loads(line)
            out[x["Type"]] = {"size": x.get("Size"), "reclaimable": x.get("Reclaimable")}
        except (ValueError, KeyError):
            pass
    return out


def _url(inst: dict, app: dict) -> str:
    if app.get("no_web"):
        return ""
    if inst["access"] == "proxy" and inst.get("domain"):
        return f"https://{inst['domain']}/"
    web = next((f"{p}/{pr}" for p, pr, k in app.get("ports", []) if k == "web"), None)
    if app.get("host_network"):
        port = next((p for p, pr, k in app["ports"] if k == "web"), None)
        return f"http://{inst.get('lan_ip') or '{host}'}:{port}/"
    hp = inst.get("host_ports", {}).get(web) if web else None
    if not hp:
        return ""
    host = inst.get("lan_ip") if inst["access"] == "lan" else "{host}"
    return f"http://{host}:{hp}/"


def _proxy_site(name: str, domain: str, port: int) -> None:
    """A managed Apache site that forwards domain → 127.0.0.1:port (HTTPS via AutoSSL, WAF + bans apply)."""
    from . import sites
    _run(["a2enmod", "-q", "proxy", "proxy_http", "proxy_wstunnel", "headers"])
    custom = "\n".join([
        "ProxyPreserveHost On",
        "ProxyPass /.well-known/acme-challenge/ !",
        f"ProxyPass / http://127.0.0.1:{port}/ upgrade=websocket timeout=3600",
        f"ProxyPassReverse / http://127.0.0.1:{port}/",
        'RequestHeader set X-Forwarded-Proto "expr=%{REQUEST_SCHEME}"',
        f"# aurora-docker-app {name}",
    ])
    settings = {"server_name": domain, "docroot": str(Path("/var/www") / f"app-{name}"), "ssl": "selfsigned", "force_https": False,
                "custom": custom, "security_headers": False, "gzip": False}
    Path(settings["docroot"]).mkdir(parents=True, exist_ok=True)
    try:
        sites.get_site(domain)
        cur = sites.get_site(domain)["settings"]
        if f"# aurora-docker-app {name}" not in (cur.get("custom") or ""):
            raise DockerError(f"{domain} is already used by another website — pick another name")
        cur.update(custom=custom)
        sites.save_site(domain, {k: v for k, v in cur.items() if not k.startswith("_")})
    except sites.SiteError:
        sites.create_site(settings)


def install(app_id: str, name: str = "", access: str = "proxy", domain: str = "", folders: dict | None = None) -> jobs.Job:
    if app_id not in CATALOG:
        raise DockerError("Unknown app")
    if not installed():
        raise DockerError("Install Docker first")
    app = CATALOG[app_id]
    name = (name or app_id).strip().lower()
    if not _NAME.match(name):
        raise DockerError("Name: lowercase letters, digits and dashes, starting with a letter")
    d = _state()
    if name in d["apps"]:
        raise DockerError(f"An app called {name} already exists")
    if access not in ("proxy", "lan", "public"):
        raise DockerError("Unknown access mode")
    lan = _lan_ip()
    if access == "lan" and not lan:
        raise DockerError("This server has no private network address — use a web address instead")
    if access == "proxy" and not app.get("no_web") and not app.get("host_network"):
        domain = (domain or "").strip().lower().rstrip(".")
        if not re.match(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$", domain):
            raise DockerError("Enter the web address for the app, e.g. jellyfin.example.com (its DNS must point here)")
    else:
        domain = ""
    if app.get("host_network") and access == "proxy":
        access = "lan" if lan else "public"
    # ports: DNS apps need the real port 53; everything else gets a free host port
    host_ports = {}
    for cport, proto, kind in app["ports"]:
        key = f"{cport}/{proto}"
        if kind == "dns":
            if not _port_free(53, proto) and access != "proxy":
                raise DockerError("Port 53 is in use (this server's DNS server?) — Pi-hole/AdGuard can't run next to it")
            host_ports[key] = 53
        elif app.get("host_network"):
            host_ports[key] = cport
        else:
            same = next((v for k, v in host_ports.items() if k.split("/")[0] == str(cport)), None)
            host_ports[key] = same or _free_port(cport if cport >= 1024 else 10000 + cport)
    env, secret_keys = {}, []
    for k, v in app["env"].items():
        if v == "{secret}":
            env[k] = secrets.token_urlsafe(18)
            secret_keys.append(k)
        elif v == "{tz}":
            env[k] = _tz()
        elif v == "{secure}":
            env[k] = "true" if access == "proxy" else "false"
        else:
            env[k] = v
    folders_out = {}
    for _, f in app["volumes"]:
        if f.startswith("@"):
            key = f[1:]
            p = (folders or {}).get(key) or str(BASE / name / key)
            p = str(Path(p).resolve())
            if not p.startswith("/") or p in ("/", "/etc", "/root", "/usr", "/var", "/boot", "/proc", "/sys", "/dev"):
                raise DockerError(f"Choose a proper folder for {key}")
            folders_out[key] = p
    inst = {"app": app_id, "access": access, "domain": domain, "lan_ip": lan, "host_ports": host_ports, "env": env, "secret_keys": secret_keys,
            "folders": folders_out, "created": int(time.time()), "image": app["image"]}

    def fn(log):
        work = BASE / name
        work.mkdir(parents=True, exist_ok=True)
        os.chmod(work, 0o700)
        for _, f in app["volumes"]:
            if not f.startswith("!"):
                p = Path(folders_out.get(f[1:]) if f.startswith("@") else work / f)
                p.mkdir(parents=True, exist_ok=True)
        for rel, text in (app.get("files") or {}).items():
            fp = work / rel
            fp.parent.mkdir(parents=True, exist_ok=True)
            if not fp.exists():
                fp.write_text(text)
        (work / "docker-compose.yml").write_text(render_compose(name, app, inst))
        os.chmod(work / "docker-compose.yml", 0o600)
        cc = compose_cmd()
        log.progress(5, f"Downloading {app['name']} ({app['image']})")
        log(f"• Downloading {app['image']} for {arch()} — the first time can take a few minutes on a Pi")
        p = subprocess.Popen(cc + ["pull"], cwd=work, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=_env())
        pct = 5.0
        for line in p.stdout:
            line = line.rstrip()
            if line:
                log(line[-200:])
                if "Pull complete" in line or "Download complete" in line:
                    pct = min(80.0, pct + 4)
                    log.progress(pct, "Downloading")
        if p.wait() != 0:
            raise DockerError("Couldn't download the image — see the log (no internet, or no build for this processor?)")
        log.progress(82, "Starting")
        r = _run(cc + ["up", "-d"], 600, cwd=work)
        log((r.stdout + r.stderr).strip()[-1500:])
        if r.returncode != 0:
            raise DockerError("The app didn't start — see the log")
        st = _state()
        st["apps"][name] = inst
        _save(st)
        if domain:
            log.progress(90, f"Creating the web address {domain}")
            web = next(f"{c}/{pr}" for c, pr, k in app["ports"] if k == "web")
            _proxy_site(name, domain, host_ports[web])
            log(f"• https://{domain}/ → the app (HTTPS: AutoSSL gets a trusted certificate once {domain} points to this server)")
        log.progress(100, f"{app['name']} is running")
        log(f"✓ {app['name']} is running")
        try:
            from . import audit
            audit.record("system", "", f"docker app installed ({name}: {app_id})")
        except Exception:
            pass
        return {"ok": True, "name": name}

    return jobs.launch_fn(f"install {app['name']}", fn, meta={"docker": name})


def _inst(name: str) -> dict:
    d = _state()
    if name not in d["apps"]:
        raise DockerError("Unknown app")
    return d["apps"][name]


def control(name: str, action: str) -> dict:
    _inst(name)
    if action not in ("start", "stop", "restart"):
        raise DockerError("Unknown action")
    r = _run(compose_cmd() + [action], 300, cwd=BASE / name)
    if r.returncode != 0:
        raise DockerError((r.stderr or r.stdout).strip()[-400:] or f"{action} failed")
    return {"ok": True}


def logs(name: str, lines: int = 300) -> dict:
    _inst(name)
    r = _run(compose_cmd() + ["logs", "--no-color", "--tail", str(max(10, min(3000, int(lines))))], 60, cwd=BASE / name)
    return {"text": (r.stdout + r.stderr)[-200000:]}


def update(name: str) -> jobs.Job:
    inst = _inst(name)

    def fn(log):
        cc = compose_cmd()
        log.progress(5, "Checking for a newer version")
        r = _run(cc + ["pull"], 1800, cwd=BASE / name)
        log((r.stdout + r.stderr).strip()[-2000:])
        if r.returncode != 0:
            raise DockerError("Download failed")
        log.progress(80, "Restarting with the new version")
        r = _run(cc + ["up", "-d"], 600, cwd=BASE / name)
        log((r.stdout + r.stderr).strip()[-1500:])
        if r.returncode != 0:
            raise DockerError("Restart failed")
        _run(["docker", "image", "prune", "-f"], 300)
        log.progress(100, "Up to date")
        log("✓ Updated (old images removed)")
        return {"ok": True}
    return jobs.launch_fn(f"update {name}", fn, meta={"docker": name})


def remove(name: str, delete_data: bool = False) -> dict:
    inst = _inst(name)
    cc = compose_cmd()
    r = _run(cc + ["down"], 300, cwd=BASE / name)
    if r.returncode != 0 and "no such" not in (r.stderr or "").lower():
        raise DockerError((r.stderr or r.stdout).strip()[-300:])
    if inst.get("domain"):
        try:
            from . import sites
            sites.remove_site(inst["domain"])
        except Exception:
            pass
    if delete_data:
        shutil.rmtree(BASE / name, ignore_errors=True)
    d = _state()
    d["apps"].pop(name, None)
    _save(d)
    return {"ok": True}


def secret(name: str, key: str) -> dict:
    inst = _inst(name)
    if key not in inst.get("secret_keys", []):
        raise DockerError("Unknown secret")
    return {"key": key, "value": inst["env"][key]}


def prune() -> dict:
    r = _run(["docker", "system", "prune", "-f"], 600)
    m = re.search(r"Total reclaimed space:\s*(.+)", r.stdout)
    return {"ok": r.returncode == 0, "reclaimed": m.group(1).strip() if m else "0B"}
