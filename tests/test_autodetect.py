"""Automatic settings: mail server name, email routing and secondary DNS follow what DNS says."""
from backend import dnszones, mail

IP = "203.0.113.7"


def fake_dns(monkeypatch, a=None, ptr="", mx=None, domains=("shop.com",)):
    a, mx = a or {}, mx or {}
    s = mail._default_state()
    s["domains"] = {d: {"routing": "auto", "catchall": {"mode": "fail"}} for d in domains}
    monkeypatch.setattr(mail, "load", lambda: s)
    monkeypatch.setattr(mail, "_public_ip", lambda: IP)
    monkeypatch.setattr(mail, "_ptr", lambda ip: ptr)
    monkeypatch.setattr(mail, "_a", lambda h: a.get(h, []))
    monkeypatch.setattr(mail, "_mx", lambda d: mx.get(d, []))
    monkeypatch.setattr(mail.socket, "getfqdn", lambda: "raspberrypi")
    return s


def test_hostname_prefers_a_matching_ptr(monkeypatch):
    fake_dns(monkeypatch, a={"mail.shop.com": [IP]}, ptr="mail.shop.com")
    d = mail.detect_hostname()
    assert d["hostname"] == "mail.shop.com" and d["ptr_ok"]


def test_hostname_uses_mail_subdomain_and_asks_for_ptr(monkeypatch):
    fake_dns(monkeypatch, a={"mail.shop.com": [IP], "1-2.isp.net": [IP]}, ptr="1-2.isp.net")
    d = mail.detect_hostname()
    assert d["hostname"] == "mail.shop.com" and not d["ptr_ok"] and "PTR" in d["reason"]


def test_hostname_falls_back_to_ptr_then_machine_name(monkeypatch):
    fake_dns(monkeypatch, a={"vps1.host.net": [IP]}, ptr="vps1.host.net")
    assert mail.detect_hostname()["hostname"] == "vps1.host.net"
    fake_dns(monkeypatch)   # a Pi at home: nothing in DNS yet
    assert mail.detect_hostname()["hostname"] == "raspberrypi"


def test_auto_routing_compares_by_ip(monkeypatch):
    fake_dns(monkeypatch, a={"mail.shop.com": [IP]}, mx={"shop.com": [(10, "mail.shop.com")]})
    assert mail._effective_routing("shop.com", {"routing": "auto"}) == "local"
    fake_dns(monkeypatch, a={"aspmx.l.google.com": ["142.250.1.1"], "mail.shop.com": [IP]},
             mx={"shop.com": [(1, "aspmx.l.google.com"), (20, "mail.shop.com")]})
    assert mail._effective_routing("shop.com", {"routing": "auto"}) == "backup"
    fake_dns(monkeypatch, mx={"shop.com": [(1, "aspmx.l.google.com")]})
    assert mail._effective_routing("shop.com", {"routing": "auto"}) == "remote"
    fake_dns(monkeypatch)   # no MX yet: receive here
    assert mail._effective_routing("shop.com", {"routing": "auto"}) == "local"
    assert mail._effective_routing("shop.com", {"routing": "remote"}) == "remote"


def test_old_local_domains_become_auto(monkeypatch, tmp_path):
    st = tmp_path / "state.json"
    st.write_text('{"domains": {"a.com": {"routing": "local"}, "b.com": {"routing": "local", "routing_set": true}}}')
    monkeypatch.setattr(mail, "STATE", st)
    s = mail.load()
    assert s["domains"]["a.com"]["routing"] == "auto" and s["domains"]["b.com"]["routing"] == "local"
    assert s["hostname_mode"] == "auto"


def test_bind_options_are_safe_by_default():
    t = dnszones.render_options([])
    assert "allow-transfer { localhost; };" in t and "also-notify" not in t
    assert "allow-recursion { localhost; localnets;" in t   # a Pi's LAN can resolve, the internet can't
    t = dnszones.render_options(["91.208.52.252", "195.88.209.83"])
    assert "allow-transfer { localhost; 91.208.52.252; 195.88.209.83; };" in t
    assert "also-notify { 91.208.52.252; 195.88.209.83; };" in t


def test_secondaries_from_ns_records(monkeypatch, tmp_path):
    (tmp_path / "db.shop.com").write_text(
        "$TTL 3600\n$ORIGIN shop.com.\n@ IN SOA ns1.shop.com. h.shop.com. ( 1 3600 1800 1209600 86400 )\n"
        "@ IN NS ns1.ipserver.su.\n@ IN NS ns2.ipserver.su.\n@ IN NS ns1.shop.com.\nns1 IN A 203.0.113.7\n")
    monkeypatch.setattr(dnszones, "ZONE_DIR", tmp_path)
    monkeypatch.setattr(dnszones, "_my_ips", lambda: {IP})
    ips = {"ns1.ipserver.su": ["91.208.52.252"], "ns2.ipserver.su": ["185.248.100.50"], "ns1.shop.com": [IP]}
    monkeypatch.setattr(dnszones, "_ips", lambda h: ips.get(h, []))
    monkeypatch.setattr(dnszones, "SECONDARIES", tmp_path / "sec.json")
    assert dnszones.detected_secondaries() == {"ns1.ipserver.su": ["91.208.52.252"], "ns2.ipserver.su": ["185.248.100.50"]}
    assert dnszones.allowed_transfer_ips() == ["185.248.100.50", "91.208.52.252"]
    (tmp_path / "sec.json").write_text('{"auto": false, "extra": ["195.88.209.83", "nope"]}')
    assert dnszones.allowed_transfer_ips() == ["195.88.209.83"]
