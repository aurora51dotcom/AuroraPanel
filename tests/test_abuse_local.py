"""Abuse reports (RDAP contact lookup, guards) and local-network mail (.local)."""
import pytest

from backend import abuse, mail


def test_only_public_addresses_can_be_reported():
    for ip in ("192.168.0.5", "10.0.0.1", "127.0.0.1", "not-an-ip"):
        with pytest.raises(abuse.AbuseError):
            abuse._public_ip(ip)
    assert abuse._public_ip(" 92.118.39.49 ") == "92.118.39.49"


def test_rdap_abuse_contact_is_found_in_nested_entities():
    found = {"abuse": [], "other": []}
    abuse._walk([{"roles": ["registrant"], "vcardArray": ["vcard", [["email", {}, "text", "noc@isp.net"]]],
                  "entities": [{"roles": ["abuse"], "vcardArray": ["vcard", [["fn", {}, "text", "Abuse"], ["email", {}, "text", "Abuse@ISP.net"]]]}]}],
                found)
    assert found == {"abuse": ["abuse@isp.net"], "other": ["noc@isp.net"]}


def test_report_body_lists_the_evidence():
    ev = [{"ts": 1792800000 + i, "source": "SSH", "user": "admin" if i % 2 else None} for i in range(3)][::-1]
    body = abuse._body("92.118.39.49", {"network": "DMZHOST"}, ev, "mail.example.com", "203.0.113.7", "")
    assert "92.118.39.49 (DMZHOST)" in body and "3 unauthorized login attempts" in body and "as user 'admin'" in body
    assert "mail.example.com (203.0.113.7)" in body


def test_local_domains(monkeypatch):
    monkeypatch.setattr(mail.socket, "gethostname", lambda: "NS1.lan")
    assert mail.local_domain_name() == "ns1.local"
    assert mail.is_local("ns1.local") and not mail.is_local("shop.com")
    s = mail._default_state()
    s["domains"] = {"ns1.local": {"routing": "local", "routing_set": True, "local": True, "catchall": {"mode": "fail"}}}
    s["accounts"] = {"admin@ns1.local": {"hash": "{SHA512-CRYPT}x", "quota_mb": 0, "suspend": {}}}
    m = mail.render_postfix(s)
    assert "ns1.local OK" in m["domains"] and "admin@ns1.local ns1.local/admin/" in m["mailboxes"]
    assert "ns1.local lmtp:unix:private/dovecot-lmtp" in m["transport"]   # ours: deliver here, not to [ns1.local]
    assert mail._effective_routing("ns1.local", {"routing": "auto"}) == "local"
    assert mail.ensure_dkim("ns1.local") is None
    assert "smtp_host_lookup" in mail.postfix_settings("h", "c", "k") and "pcre:" in mail.postfix_settings("h", "c", "k")["transport_maps"]


def test_report_body_includes_web_attacks():
    ev = [{"ts": 1792800100, "source": "web firewall", "kind": "attack", "detail": "SQL injection (libinjection) — GET /?id=1 — blocked"},
          {"ts": 1792800000, "source": "SSH", "user": "root"}]
    body = abuse._body("192.0.2.9", {}, ev, "mail.example.com", "203.0.113.7", "")
    assert "1 unauthorized login attempt and 1 web attack" in body
    assert "web firewall: SQL injection" in body and "failed login as user 'root'" in body
