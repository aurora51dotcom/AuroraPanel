"""cPanel import: reading a backup's table of contents."""
import io
import tarfile

from backend import migrate

MAIN = """---
addon_domains:
  shop.org: shop.example.com
main_domain: example.com
parked_domains: []
sub_domains:
  - blog.example.com
  - shop.example.com
  - evil.example.com
user: bob
"""


def _backup(tmp_path):
    files = {
        "userdata/main": MAIN,
        "userdata/example.com": "---\ndocumentroot: /home/bob/public_html\nserveralias: www.example.com\n",
        "userdata/blog.example.com": "---\ndocumentroot: /home/bob/blog\n",
        "userdata/shop.example.com": "---\ndocumentroot: /home/bob/shop\nserveralias: shop.org www.shop.org www.shop.example.com\n",
        "userdata/evil.example.com": "---\ndocumentroot: /home/bob/../../../etc\n",
        "mysql/bob_wp.sql": "CREATE TABLE t (id INT);\n",
        "mysql.sql": "GRANT USAGE ON *.* TO 'bob_u'@'localhost' IDENTIFIED BY PASSWORD '*0123456789ABCDEF0123456789ABCDEF01234567';\n",
        "etc/example.com/shadow": "info:$6$salt$hash:19000::::::\n../../x:$6$a$b:1::::::\n",
        "homedir/mail/example.com/info/cur/1": "mail",
        "va/example.com": "sales@example.com: info@example.com\n",
        "dnszones/example.com.db": "$TTL 300\n",
    }
    p = tmp_path / "cpmove-bob.tar.gz"
    with tarfile.open(p, "w:gz") as tf:
        for name, text in files.items():
            data = text.encode()
            ti = tarfile.TarInfo(f"cpmove-bob/{name}")
            ti.size = len(data)
            tf.addfile(ti, io.BytesIO(data))
    return p


def test_analyze(tmp_path, monkeypatch):
    p = _backup(tmp_path)
    monkeypatch.setattr(migrate, "candidates", lambda: [{"path": str(p.resolve())}])
    a = migrate.analyze(str(p))
    sites = {s["domain"]: s for s in a["sites"]}
    assert a["user"] == "bob" and a["main_domain"] == "example.com"
    # the addon is listed under its own name, not cPanel's internal subdomain
    assert set(sites) == {"example.com", "blog.example.com", "shop.org", "evil.example.com"}
    assert sites["shop.org"]["docroot_rel"] == "shop" and sites["shop.org"]["kind"] == "addon"
    assert sites["shop.org"]["aliases"] == ["www.shop.org"]
    assert sites["example.com"]["aliases"] == ["www.example.com"]
    # a document root pointing outside the home folder is ignored
    assert sites["evil.example.com"]["docroot_rel"] == "evil.example.com"
    # an unsafe mailbox name is not offered
    assert [m["address"] for m in a["mailboxes"]] == ["info@example.com"]
    assert a["databases"][0]["name"] == "bob_wp" and a["db_users"] == ["bob_u"]
    assert a["forwarders"] == 1 and a["zones"] == ["example.com"]


def test_yaml_helpers():
    assert migrate._yaml_list(MAIN, "sub_domains") == ["blog.example.com", "shop.example.com", "evil.example.com"]
    assert migrate._yaml_list(MAIN, "parked_domains") == []
    assert migrate._yaml_map_keys(MAIN, "addon_domains") == {"shop.org": "shop.example.com"}
    assert not migrate._DOMAIN.fullmatch("user: bob")
