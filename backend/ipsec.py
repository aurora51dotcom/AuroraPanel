"""strongSwan IKEv2 road-warrior server (swanctl / charon-systemd).

Server authenticates with a certificate from a panel-owned CA; users log in
with EAP-MSCHAPv2 username + password, which every OS supports natively.
Clients get the CA cert plus ready-made profiles (.mobileconfig for Apple,
.sswan for the strongSwan Android app, a PowerShell snippet for Windows)."""
from __future__ import annotations

import base64
import ipaddress
import json
import re
import secrets
import time
import uuid
from pathlib import Path

from . import jobs
from .vpncommon import (
    STATE_DIR, VPNError, control as _control, dns_servers, enable_forwarding, endpoint,
    load_json, run, save_json, set_nat, ufw_close, ufw_open, unit_state, valid_name, which,
    write_secret, apt_install, nat_active, forwarding_enabled, default_route,
)

SWAN = Path("/etc/swanctl")
CONF = SWAN / "conf.d" / "aurora.conf"
USERS = SWAN / "conf.d" / "aurora-users.conf"
CA_CRT = SWAN / "x509ca" / "aurora-ca.crt"
SRV_CRT = SWAN / "x509" / "aurora-server.crt"
SRV_KEY = SWAN / "private" / "aurora-server.key"
CA_KEY = STATE_DIR / "ipsec-ca.key"
STATE = STATE_DIR / "ipsec.json"
UNIT = "strongswan"
CA_CN = "AuroraPanel IKEv2 CA"
PKGS = ["charon-systemd", "strongswan-swanctl", "strongswan-pki", "libcharon-extra-plugins",
        "libcharon-extauth-plugins", "nftables"]
_DEFAULT = {"subnet": "10.10.0.0/24", "host": "", "users": {}}


def _state() -> dict:
    return load_json(STATE, _DEFAULT)


def install() -> jobs.Job:
    return apt_install("install strongSwan", PKGS, meta={"vpn": "ipsec"})


def _installed() -> bool:
    return which("swanctl", "pki")


def _issue_server(host: str):
    san = ["--san", host]  # pki encodes an IP literal as an IP SAN, else as a DNS name
    key = run(["pki", "--gen", "--type", "rsa", "--size", "3072", "--outform", "pem"], timeout=180).stdout
    write_secret(SRV_KEY, key)
    pub = run(["pki", "--pub", "--in", str(SRV_KEY), "--type", "rsa", "--outform", "pem"]).stdout
    crt = run(["pki", "--issue", "--lifetime", "1825", "--cacert", str(CA_CRT), "--cakey", str(CA_KEY),
               "--dn", f"CN={host}", *san, "--flag", "serverAuth", "--flag", "ikeIntermediate",
               "--outform", "pem"], input=pub, timeout=60).stdout
    SRV_CRT.write_text(crt)


def _render(s: dict):
    net = ipaddress.ip_network(s["subnet"])
    dns = ",".join(dns_servers())
    CONF.write_text(f"""# Managed by AuroraPanel — edits here are overwritten.
connections {{
  aurora {{
    version = 2
    proposals = aes256-sha256-modp2048,aes256gcm16-prfsha384-ecp384,aes256-sha256-ecp256,aes128-sha256-modp2048,aes256-sha1-modp2048,default
    pools = aurora_pool
    send_cert = always
    unique = never
    fragmentation = yes
    dpd_delay = 30s
    rekey_time = 0
    local {{
      auth = pubkey
      certs = aurora-server.crt
      id = {s['host']}
    }}
    remote {{
      auth = eap-mschapv2
      eap_id = %any
    }}
    children {{
      aurora {{
        local_ts = 0.0.0.0/0
        esp_proposals = aes256gcm16,aes256-sha256,aes128-sha256,aes256-sha1,default
        dpd_action = clear
        rekey_time = 0
      }}
    }}
  }}
}}
pools {{
  aurora_pool {{
    addrs = {net}
    dns = {dns}
  }}
}}
""", encoding="utf-8")
    body = "".join(
        f'  eap-{i} {{\n    id = {json.dumps(u)}\n    secret = {json.dumps(p)}\n  }}\n'
        for i, (u, p) in enumerate(sorted(s["users"].items())))
    write_secret(USERS, "# Managed by AuroraPanel\nsecrets {\n" + body + "}\n")


def _reload():
    if unit_state(UNIT)["active"]:
        run(["swanctl", "--load-all", "--noprompt"], timeout=30)


def setup(subnet: str = "10.10.0.0/24") -> jobs.Job:
    if not _installed():
        raise VPNError("strongSwan (swanctl, pki) is not installed")
    try:
        net = ipaddress.ip_network(subnet, strict=False)
    except ValueError:
        raise VPNError("Invalid subnet")
    if not net.is_private or net.prefixlen > 29:
        raise VPNError("Use a private subnet of /29 or larger, e.g. 10.10.0.0/24")
    lan = default_route().get("lan")
    if lan and net.overlaps(ipaddress.ip_network(lan)):
        raise VPNError(f"The VPN subnet overlaps your LAN ({lan})")
    host = endpoint()
    old = _state() if CONF.exists() else None

    def fn(log):
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        if not (CA_KEY.exists() and CA_CRT.exists()):
            log("• Creating the IKEv2 certificate authority (RSA 3072)…")
            write_secret(CA_KEY, run(["pki", "--gen", "--type", "rsa", "--size", "3072", "--outform", "pem"],
                                     timeout=180).stdout)
            ca = run(["pki", "--self", "--ca", "--lifetime", "3650", "--in", str(CA_KEY), "--type", "rsa",
                      "--dn", f"CN={CA_CN}", "--outform", "pem"]).stdout
            CA_CRT.parent.mkdir(parents=True, exist_ok=True)
            CA_CRT.write_text(ca)
        s = _state()
        if s["host"] != host or not SRV_CRT.exists():
            log(f"• Issuing the server certificate for {host}…")
            _issue_server(host)
        s.update(subnet=str(net), host=host)
        save_json(STATE, s)
        _render(s)
        enable_forwarding()
        if old and old["subnet"] != s["subnet"]:
            set_nat(old["subnet"], False)
            ufw_close(500, "udp", old["subnet"])
        set_nat(s["subnet"], True)
        ufw_open(500, "udp", s["subnet"])
        ufw_open(4500, "udp")
        log("• Starting strongSwan…")
        run(["systemctl", "enable", UNIT])
        run(["systemctl", "restart", UNIT], timeout=60)
        for _ in range(20):
            time.sleep(0.5)
            if unit_state(UNIT)["active"]:
                break
        time.sleep(1)
        out = run(["swanctl", "--load-all", "--noprompt"], timeout=30).stdout
        log(out.strip())
        conns = run(["swanctl", "--list-conns"], check=False).stdout
        if "aurora:" not in conns:
            raise VPNError("strongSwan did not load the 'aurora' connection")
        log(f"✔ IKEv2 server ready for {host} (UDP 500 + 4500)")
        return {"ok": True}
    return jobs.launch_fn("IPsec/IKEv2 setup", fn, meta={"vpn": "ipsec"})


def _sas() -> dict:
    """username -> live session info, parsed from `swanctl --list-sas`."""
    out = run(["swanctl", "--list-sas"], check=False).stdout
    users, cur = {}, None
    for line in out.splitlines():
        m = re.match(r"^aurora: #\d+, (\w+)", line)
        if m:
            cur = {"state": m.group(1), "rx": 0, "tx": 0}
            continue
        if cur is None:
            continue
        # e.g. "remote 'iphone' @ 203.0.113.9[4500] EAP: 'iphone' [10.10.0.1]" (EAP part optional)
        m = re.search(r"remote '([^']*)' @ ([^\[\s]+)\[\d+\](?: EAP: '([^']+)')?(?: \[([\d.]+)\])?", line)
        if m:
            cur.update(remote=m.group(2), virtual_address=m.group(4))
            users[m.group(3) or m.group(1)] = cur
        m = re.search(r"established (\d+)s ago", line)
        if m:
            cur["since"] = int(time.time()) - int(m.group(1))
        m = re.search(r"^\s+in\s+\S+,\s+(\d+) bytes", line)
        if m:
            cur["rx"] += int(m.group(1))
        m = re.search(r"^\s+out\s+\S+,\s+(\d+) bytes", line)
        if m:
            cur["tx"] += int(m.group(1))
    return users


def status() -> dict:
    installed = _installed()
    s = _state()
    configured = CONF.exists() and SRV_CRT.exists() and CA_CRT.exists()
    u = unit_state(UNIT) if installed else {"active": False, "enabled": False}
    live = _sas() if u.get("active") else {}
    users = [{"name": n, "online": n in live, **live.get(n, {})} for n in sorted(s["users"])]
    try:
        current = endpoint()
    except VPNError:
        current = None
    return {"installed": installed, "configured": configured, **u, "subnet": s["subnet"],
            "host": s["host"], "endpoint": current, "host_mismatch": bool(configured and current and current != s["host"]),
            "ports": [{"port": 500, "proto": "udp"}, {"port": 4500, "proto": "udp"}],
            "users": users, "forwarding": forwarding_enabled(), "nat": configured and nat_active(s["subnet"])}


def control(action: str) -> dict:
    if not CONF.exists():
        raise VPNError("Set up the IPsec server first")
    r = _control(UNIT, action)
    if action != "stop":
        time.sleep(1)
        run(["swanctl", "--load-all", "--noprompt"], check=False, timeout=30)
    return r


def add_user(name: str, password: str | None = None) -> dict:
    s = _state()
    if not CONF.exists():
        raise VPNError("Set up the IPsec server first")
    name = valid_name(name)
    if name in s["users"]:
        raise VPNError("That user already exists")
    password = (password or "").strip() or secrets.token_urlsafe(12)
    if len(password) < 8 or '"' in password or "\\" in password:
        raise VPNError("Password: at least 8 characters, no quotes or backslashes")
    s["users"][name] = password
    save_json(STATE, s)
    _render(s)
    _reload()
    return {"ok": True, "name": name, "password": password}


def remove_user(name: str) -> dict:
    s = _state()
    if name not in s["users"]:
        raise VPNError("No such user")
    online = unit_state(UNIT)["active"] and name in _sas()
    del s["users"][name]
    save_json(STATE, s)
    _render(s)
    _reload()
    if online:
        # Drop the live session; swanctl can't target one EAP identity, so all
        # sessions reconnect (other users' devices do so automatically).
        run(["swanctl", "--terminate", "--ike", "aurora", "--force"], check=False, timeout=15)
    return {"ok": True}


def ca_pem() -> str:
    if not CA_CRT.exists():
        raise VPNError("No CA yet — set up the IPsec server first")
    return CA_CRT.read_text()


def _ca_der_b64() -> str:
    body = re.search(r"-----BEGIN CERTIFICATE-----(.*?)-----END CERTIFICATE-----", ca_pem(), re.S).group(1)
    return "".join(body.split())


def client_profiles(name: str) -> dict:
    s = _state()
    if name not in s["users"]:
        raise VPNError("No such user")
    host, pw = s["host"], s["users"][name]
    ca = _ca_der_b64()
    u1, u2, u3 = (str(uuid.uuid4()).upper() for _ in range(3))
    params = """<dict><key>EncryptionAlgorithm</key><string>AES-256</string>
          <key>IntegrityAlgorithm</key><string>SHA2-256</string>
          <key>DiffieHellmanGroup</key><integer>14</integer></dict>"""
    mobileconfig = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>PayloadDisplayName</key><string>AuroraPanel VPN ({name})</string>
  <key>PayloadIdentifier</key><string>aurora.vpn.{u1}</string>
  <key>PayloadUUID</key><string>{u1}</string>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadContent</key><array>
    <dict>
      <key>PayloadType</key><string>com.apple.security.root</string>
      <key>PayloadIdentifier</key><string>aurora.vpn.ca.{u2}</string>
      <key>PayloadUUID</key><string>{u2}</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadDisplayName</key><string>{CA_CN}</string>
      <key>PayloadContent</key><data>{ca}</data>
    </dict>
    <dict>
      <key>PayloadType</key><string>com.apple.vpn.managed</string>
      <key>PayloadIdentifier</key><string>aurora.vpn.ikev2.{u3}</string>
      <key>PayloadUUID</key><string>{u3}</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadDisplayName</key><string>Aurora VPN</string>
      <key>UserDefinedName</key><string>Aurora VPN</string>
      <key>VPNType</key><string>IKEv2</string>
      <key>IKEv2</key><dict>
        <key>RemoteAddress</key><string>{host}</string>
        <key>RemoteIdentifier</key><string>{host}</string>
        <key>LocalIdentifier</key><string>{name}</string>
        <key>ServerCertificateIssuerCommonName</key><string>{CA_CN}</string>
        <key>AuthenticationMethod</key><string>None</string>
        <key>ExtendedAuthEnabled</key><integer>1</integer>
        <key>AuthName</key><string>{name}</string>
        <key>AuthPassword</key><string>{pw}</string>
        <key>IKESecurityAssociationParameters</key>{params}
        <key>ChildSecurityAssociationParameters</key>{params}
        <key>DeadPeerDetectionRate</key><string>Medium</string>
      </dict>
    </dict>
  </array>
</dict></plist>
"""
    sswan = json.dumps({"uuid": str(uuid.uuid4()), "name": f"Aurora VPN ({name})", "type": "ikev2-eap",
                        "remote": {"addr": host, "id": host, "cert": ca},
                        "local": {"eap_id": name}}, indent=2)
    windows = (
        f"# Run in an elevated PowerShell (as Administrator) after downloading aurora-ca.crt\n"
        f"Import-Certificate -FilePath .\\aurora-ca.crt -CertStoreLocation Cert:\\LocalMachine\\Root\n"
        f"Add-VpnConnection -Name 'Aurora VPN' -ServerAddress '{host}' -TunnelType Ikev2 "
        f"-AuthenticationMethod Eap -EncryptionLevel Required -RememberCredential -Force\n"
        f"Set-VpnConnectionIPsecConfiguration -ConnectionName 'Aurora VPN' -AuthenticationTransformConstants GCMAES256 "
        f"-CipherTransformConstants GCMAES256 -EncryptionMethod AES256 -IntegrityCheckMethod SHA256 "
        f"-DHGroup Group14 -PfsGroup None -Force\n"
        f"# Then connect from Settings > Network > VPN with username '{name}' and your password.\n")
    return {"name": name, "password": pw, "host": host, "ca_pem": ca_pem(),
            "mobileconfig": mobileconfig, "sswan": sswan, "windows_ps": windows}


def external_evidence(port: int, proto: str) -> str | None:
    if proto != "udp" or int(port) not in (500, 4500) or not _installed() or not unit_state(UNIT)["active"]:
        return None
    lan = default_route().get("lan")
    for user, sa in _sas().items():
        try:
            a = ipaddress.ip_address(sa.get("remote", ""))
        except ValueError:
            continue
        if not a.is_private and not (lan and a in ipaddress.ip_network(lan)):
            return f"IKEv2 user '{user}' is connected from {a}"
    return None
