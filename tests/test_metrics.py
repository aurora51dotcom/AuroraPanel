"""Metrics log parsing, WAF config rendering and Dynamic DNS update answers (no system access)."""
from backend import ddnshosts, metrics, waf


def test_parse_combined_and_vhost():
    e = metrics.parse_access('71.197.107.133 - - [24/Oct/2026:09:35:38 +0300] "GET /a?b=1 HTTP/1.1" 200 10927 "https://x.test/" "curl/8.21.0"')
    assert e["ip"] == "71.197.107.133" and e["status"] == 200 and e["size"] == 10927 and e["url"] == "/a?b=1"
    assert e["ref"] == "https://x.test/" and e["ua"] == "curl/8.21.0"
    assert e["ts"] == 1792823738.0  # 06:35:38 UTC
    v = metrics.parse_access('ex.com:443 2a0a:20c0::4 - bob [24/Oct/2026:11:48:05 +0000] "POST / HTTP/2.0" 301 - "-" "-"', vhost_fmt=True)
    assert v["vhost"] == "ex.com" and v["ip"] == "2a0a:20c0::4" and v["user"] == "bob" and v["size"] == 0 and v["ref"] == ""
    assert metrics.parse_access("garbage line") is None


def test_classify_ua():
    chrome = metrics.classify_ua("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36")
    assert chrome == {"bot": False, "browser": "Chrome", "os": "Windows 10/11", "device": "desktop"}
    iphone = metrics.classify_ua("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")
    assert iphone["browser"] == "Safari" and iphone["os"] == "iOS" and iphone["device"] == "phone"
    assert metrics.classify_ua("Mozilla/5.0 (compatible; Googlebot/2.1)")["browser"] == "Googlebot"
    assert metrics.classify_ua("Mozilla/5.0 (l9scan/2.0.1; +https://leakix.net)")["browser"] == "l9scan"
    assert metrics.classify_ua("")["bot"] is True


def test_pages_and_error_categories():
    assert metrics.is_page("/blog/post?x=1", 200) and not metrics.is_page("/style.css", 200) and not metrics.is_page("/x", 404)
    cat = metrics._err_category
    assert cat("core", "error", "AH10244: invalid URI path (//../.env)") == "security"
    assert cat("php", "error", "script '/var/www/html/info.php' not found or unable to stat") == "missing"
    assert cat("core", "crit", "(13)Permission denied: /home/x/.htaccess pcfg_openfile") == "permission"
    assert cat("php", "warn", "PHP Warning:  preg_match(): JIT") == "php_warn"
    assert cat("php", "error", "PHP Fatal error:  Uncaught Error") == "php_fatal"
    assert metrics._pattern("[client 1.2.3.4:5] File /var/www/a/b.php line 12") == metrics._pattern("[client 9.9.9.9:1] File /srv/c.php line 99")


def test_waf_render(monkeypatch):
    s = waf._default() | {"mode": "detect", "paranoia": 3, "trusted": ["10.0.0.0/8"], "sites_off": ["a.test"]}
    pre = waf.render_pre(s)
    assert "SecRuleEngine DetectionOnly" in pre and "tx.paranoia_level=3" in pre and "@ipMatch 10.0.0.0/8" in pre
    assert "tx.crs_exclusions_wordpress=1" in pre and "aurora-sites-off.txt" in pre
    post = waf.render_post(s | {"disabled_rules": {"942100": {"msg": "SQLi"}}})
    assert "SecRuleRemoveById 942100" in post
    assert waf._clean_ips(["1.2.3.4", "10.1.2.3/8", ""]) == ["1.2.3.4", "10.0.0.0/8"]


def test_ddns_remote_update(tmp_path, monkeypatch):
    monkeypatch.setattr(ddnshosts, "STATE", tmp_path / "d.json")
    set_calls = []
    monkeypatch.setattr(ddnshosts, "_set_record", lambda h, ip: set_calls.append(ip))
    ddnshosts._save({"hosts": [{"id": "x", "host": "home.ex.com", "domain": "ex.com", "key": "secretkey", "ip": "", "ip6": "", "updated": 0}]})
    assert ddnshosts.remote_update("wrong", "", "1.2.3.4") == "badauth"
    assert ddnshosts.remote_update("secretkey", "", "203.0.113.5") == "good 203.0.113.5"
    assert ddnshosts.remote_update("secretkey", "", "203.0.113.5") == "nochg 203.0.113.5"
    assert ddnshosts.remote_update("secretkey", "203.0.113.6", "1.1.1.1") == "abuse"  # too soon
    assert ddnshosts.remote_update("secretkey", "2001:db8::1", "1.1.1.1") == "good 2001:db8::1"  # IPv6 is separate
    assert ddnshosts.remote_update("secretkey", "", "1.1.1.1", "other.ex.com") == "nohost"
    assert ddnshosts.remote_update("secretkey", "not-an-ip", "1.1.1.1") == "badip"
    assert set_calls == ["203.0.113.5", "2001:db8::1"]
    assert "key" not in ddnshosts.listing()["hosts"][0]
