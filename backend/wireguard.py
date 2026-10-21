"""WireGuard VPN server: wg0 rendered from a JSON registry, per-peer client
configs + QR codes, live stats from `wg show dump`, namespace self-test."""
from __future__ import annotations

import ipaddress
import subprocess
import tempfile
import time
from pathlib import Path

from . import jobs
from .vpncommon import (
    STATE_DIR, VPNError, control as _control, default_route, dns_servers, enable_forwarding,
    endpoint, load_json, next_free_ip, ns_cleanup, ns_exec, ns_ping, run, save_json, set_nat,
    TEST_NS, ufw_close, ufw_open, unit_state, valid_name, which, write_secret, apt_install,
    nat_active, forwarding_enabled,
)

IFACE = "wg0"
CONF = Path(f"/etc/wireguard/{IFACE}.conf")
STATE = STATE_DIR / "wireguard.json"
UNIT = f"wg-quick@{IFACE}"
PKGS = ["wireguard-tools", "qrencode", "nftables", "iproute2"]
_DEFAULT = {"port": 51820, "subnet": "10.8.0.0/24", "private_key": "", "public_key": "", "peers": []}


def _state() -> dict:
    return load_json(STATE, _DEFAULT)


def _genkey() -> tuple[str, str]:
    priv = run(["wg", "genkey"]).stdout.strip()
    pub = run(["wg", "pubkey"], input=priv + "\n").stdout.strip()
    return priv, pub


def _render(s: dict):
    net = ipaddress.ip_network(s["subnet"])
    lines = [
        "# Managed by AuroraPanel — edits here are overwritten.",
        "[Interface]",
        f"Address = {net.network_address + 1}/{net.prefixlen}",
        f"ListenPort = {s['port']}",
        f"PrivateKey = {s['private_key']}",
    ]
    for p in s["peers"]:
        if p.get("disabled"):
            continue
        lines += ["", f"# {p['name']}", "[Peer]", f"PublicKey = {p['public_key']}",
                  f"PresharedKey = {p['psk']}", f"AllowedIPs = {p['ip']}/32"]
    write_secret(CONF, "\n".join(lines) + "\n")


def _apply(s: dict):
    """Write wg0.conf and push peer changes live without dropping tunnels."""
    _render(s)
    if not unit_state(UNIT)["active"]:
        return
    stripped = run(["wg-quick", "strip", IFACE]).stdout
    with tempfile.NamedTemporaryFile("w", delete=False, suffix=".conf") as f:
        f.write(stripped)
        tmp = f.name
    try:
        run(["wg", "syncconf", IFACE, tmp])
    finally:
        Path(tmp).unlink(missing_ok=True)


def install() -> jobs.Job:
    return apt_install("install WireGuard", PKGS, meta={"vpn": "wireguard"})


def setup(port: int = 51820, subnet: str = "10.8.0.0/24") -> dict:
    if not which("wg", "wg-quick"):
        raise VPNError("WireGuard is not installed")
    if CONF.exists() and "AuroraPanel" not in CONF.read_text(errors="replace"):
        raise VPNError(f"{CONF} already exists and was not created by AuroraPanel — remove it first")
    port = int(port)
    if not 1 <= port <= 65535:
        raise VPNError("Invalid port")
    try:
        net = ipaddress.ip_network(subnet, strict=False)
    except ValueError:
        raise VPNError("Invalid subnet")
    if not net.is_private or net.prefixlen > 29:
        raise VPNError("Use a private subnet of /29 or larger, e.g. 10.8.0.0/24")
    lan = default_route().get("lan")
    if lan and net.overlaps(ipaddress.ip_network(lan)):
        raise VPNError(f"The VPN subnet overlaps your LAN ({lan})")
    s = _state()
    old = (s["port"], s["subnet"]) if s["private_key"] else None
    if not s["private_key"]:
        s["private_key"], s["public_key"] = _genkey()
    if old and old[1] != str(net) and s["peers"]:
        raise VPNError("Remove all clients before changing the subnet")
    s["port"], s["subnet"] = port, str(net)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    save_json(STATE, s)
    _render(s)
    enable_forwarding()
    if old:
        set_nat(old[1], False)
        ufw_close(old[0], "udp", old[1])
    set_nat(s["subnet"], True)
    ufw_open(port, "udp", s["subnet"])
    run(["systemctl", "enable", UNIT])
    run(["systemctl", "restart", UNIT], timeout=60)
    return status()


def _dump() -> dict:
    """public_key -> live stats."""
    r = run(["wg", "show", IFACE, "dump"], check=False)
    peers = {}
    for i, line in enumerate(r.stdout.splitlines()):
        f = line.split("\t")
        if i == 0 or len(f) < 8:
            continue
        hs = int(f[4] or 0)
        peers[f[0]] = {"endpoint": None if f[2] == "(none)" else f[2], "latest_handshake": hs or None,
                       "rx": int(f[5] or 0), "tx": int(f[6] or 0)}
    return peers


def status() -> dict:
    installed = which("wg", "wg-quick")
    s = _state()
    u = unit_state(UNIT) if installed else {"active": False, "enabled": False}
    live = _dump() if u.get("active") else {}
    now = time.time()
    peers = []
    for p in s["peers"]:
        l = live.get(p["public_key"], {})
        hs = l.get("latest_handshake")
        peers.append({"name": p["name"], "ip": p["ip"], "tunnel": p.get("tunnel", "full"),
                      "created": p.get("created"), "disabled": bool(p.get("disabled")),
                      "endpoint": l.get("endpoint"), "latest_handshake": hs,
                      "online": bool(hs and now - hs < 180), "rx": l.get("rx", 0), "tx": l.get("tx", 0)})
    configured = bool(s["private_key"]) and CONF.exists()
    return {"installed": installed, "configured": configured, **u, "port": s["port"], "proto": "udp",
            "subnet": s["subnet"], "public_key": s["public_key"], "peers": peers,
            "forwarding": forwarding_enabled(), "nat": configured and nat_active(s["subnet"])}


def control(action: str) -> dict:
    if not _state()["private_key"]:
        raise VPNError("Set up the WireGuard server first")
    return _control(UNIT, action)


def add_peer(name: str, tunnel: str = "full") -> dict:
    s = _state()
    if not s["private_key"]:
        raise VPNError("Set up the WireGuard server first")
    name = valid_name(name)
    if any(p["name"] == name for p in s["peers"]):
        raise VPNError("A client with that name already exists")
    if tunnel not in ("full", "split"):
        raise VPNError("Tunnel must be full or split")
    priv, pub = _genkey()
    psk = run(["wg", "genpsk"]).stdout.strip()
    ip = next_free_ip(s["subnet"], {p["ip"] for p in s["peers"]})
    s["peers"].append({"name": name, "private_key": priv, "public_key": pub, "psk": psk, "ip": ip,
                       "tunnel": tunnel, "created": int(time.time())})
    save_json(STATE, s)
    _apply(s)
    return {"ok": True, "name": name, "ip": ip}


def _peer(s: dict, name: str) -> dict:
    p = next((p for p in s["peers"] if p["name"] == name), None)
    if not p:
        raise VPNError("No such client")
    return p


def remove_peer(name: str) -> dict:
    s = _state()
    _peer(s, name)
    s["peers"] = [p for p in s["peers"] if p["name"] != name]
    save_json(STATE, s)
    _apply(s)
    return {"ok": True}


def set_peer_disabled(name: str, disabled: bool) -> dict:
    s = _state()
    _peer(s, name)["disabled"] = bool(disabled)
    save_json(STATE, s)
    _apply(s)
    return {"ok": True}


def client_config(name: str) -> dict:
    s = _state()
    p = _peer(s, name)
    if p["tunnel"] == "full":
        allowed = "0.0.0.0/0, ::/0"
    else:
        allowed = ", ".join(x for x in (s["subnet"], default_route().get("lan")) if x)
    conf = "\n".join([
        "[Interface]",
        f"PrivateKey = {p['private_key']}",
        f"Address = {p['ip']}/32",
        f"DNS = {', '.join(dns_servers())}",
        "",
        "[Peer]",
        f"PublicKey = {s['public_key']}",
        f"PresharedKey = {p['psk']}",
        f"Endpoint = {endpoint()}:{s['port']}",
        f"AllowedIPs = {allowed}",
        "PersistentKeepalive = 25",
    ]) + "\n"
    svg = None
    if which("qrencode"):
        r = run(["qrencode", "-t", "SVG", "-m", "2", "-o", "-"], input=conf, check=False)
        if r.returncode == 0:
            svg = r.stdout
    return {"name": name, "filename": f"{name}.conf", "config": conf, "qr_svg": svg}


def selftest() -> jobs.Job:
    """Connect a throwaway peer from a network namespace through the real server
    (UDP socket on the host, endpoint 127.0.0.1) and ping across the tunnel."""
    def fn(log):
        st = status()
        if not st["configured"] or not st["active"]:
            raise VPNError("WireGuard must be set up and running")
        s = _state()
        test_ip = str(ipaddress.ip_network(s["subnet"]).broadcast_address - 1)
        if any(p["ip"] == test_ip for p in s["peers"]):
            raise VPNError(f"{test_ip} is taken by a client; can't run the self-test")
        priv, pub = _genkey()
        ns_cleanup()
        keyfile = Path(tempfile.mkstemp()[1])
        ok = False
        try:
            keyfile.write_text(priv + "\n")
            log(f"• Adding temporary peer {test_ip} to {IFACE}")
            run(["wg", "set", IFACE, "peer", pub, "allowed-ips", f"{test_ip}/32"])
            run(["ip", "netns", "add", TEST_NS])
            run(["ip", "link", "add", "aurwgtest", "type", "wireguard"])
            run(["ip", "link", "set", "aurwgtest", "netns", TEST_NS])
            ns_exec(["ip", "link", "set", "lo", "up"])
            for argv in (["wg", "set", "aurwgtest", "private-key", str(keyfile), "peer", s["public_key"],
                          "endpoint", f"127.0.0.1:{s['port']}", "allowed-ips", "0.0.0.0/0",
                          "persistent-keepalive", "1"],
                         ["ip", "addr", "add", f"{test_ip}/32", "dev", "aurwgtest"],
                         ["ip", "link", "set", "aurwgtest", "up"],
                         ["ip", "route", "add", "default", "dev", "aurwgtest"]):
                r = ns_exec(argv)
                if r.returncode != 0:
                    raise VPNError(f"{' '.join(argv)}: {r.stderr.strip()}")
            log("• Test client started in namespace, connecting to 127.0.0.1:%s" % s["port"])
            server_ip = str(ipaddress.ip_network(s["subnet"]).network_address + 1)
            tunnel = ns_ping(log, server_ip, "Handshake + tunnel to the server")
            hs = _dump().get(pub, {}).get("latest_handshake")
            log(f"{'✔' if hs else '✖'} Server saw the handshake")
            internet = ns_ping(log, "1.1.1.1", "Internet through the VPN (forwarding + NAT)")
            ok = tunnel and bool(hs) and internet
        finally:
            ns_cleanup()
            subprocess.run(["wg", "set", IFACE, "peer", pub, "remove"], capture_output=True)
            keyfile.unlink(missing_ok=True)
            log("• Cleaned up the temporary peer and namespace")
        if not ok:
            raise VPNError("Self-test failed — see the steps above")
        log("✔ WireGuard works. Remote devices additionally need the UDP port forwarded on your router.")
        return {"ok": True}
    return jobs.launch_fn("WireGuard self-test", fn, meta={"vpn": "wireguard"})


def external_evidence(port: int, proto: str) -> str | None:
    """A peer handshaking recently from a non-LAN address proves the port is open."""
    st = status() if which("wg") else None
    if not st or not st["active"] or proto != "udp" or int(port) != st["port"]:
        return None
    lan = default_route().get("lan")
    for p in st["peers"]:
        ep = (p["endpoint"] or "").rsplit(":", 1)[0].strip("[]")
        if p["online"] and ep:
            try:
                a = ipaddress.ip_address(ep)
            except ValueError:
                continue
            if not a.is_private and not (lan and a in ipaddress.ip_network(lan)):
                return f"WireGuard client '{p['name']}' is connected from {ep}"
    return None
