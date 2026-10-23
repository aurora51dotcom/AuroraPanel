"""App Installer: the catalog is consistent, and installs pick the right address and folder."""
import pytest

from backend import appcatalog, apps

KINDS = {"cli", "web", "static", "composer", "unavailable"}
CATS = {c["id"] for c in appcatalog.CATEGORIES}


def test_catalog_entries_are_complete():
    ids = [a["id"] for a in appcatalog.APPS]
    assert len(ids) == len(set(ids)), "duplicate app ids"
    for a in appcatalog.APPS:
        assert a["kind"] in KINDS, a["id"]
        assert a["cat"] in CATS, a["id"]
        assert a.get("name") and a.get("tagline") and a.get("site", "").startswith("http"), a["id"]
        if a["kind"] == "unavailable":
            assert a.get("why"), a["id"]
            continue
        if a["kind"] == "composer":
            assert a.get("composer"), a["id"]
        else:
            assert a.get("source", {}).get("t") in ("fn", "gh", "url"), a["id"]
        if a["kind"] == "cli":
            assert callable(a.get("install")), a["id"]
        if a.get("db"):
            assert a.get("db_prefix") and len(a["db_prefix"]) <= 6, a["id"]


def test_every_category_has_apps():
    used = {a["cat"] for a in appcatalog.APPS}
    assert CATS == used


def test_catalog_api_has_no_functions(monkeypatch):
    monkeypatch.setattr(apps, "_php_info", lambda: {"php_version": "8.4", "php_bin": "php", "mods": {"mysqli"}})
    import json
    c = apps.catalog()
    json.dumps(c)  # must be plain data
    wp = next(a for a in c["apps"] if a["id"] == "wordpress")
    assert "install" not in wp and "source" not in wp and "curl" in wp["missing_exts"]


def test_url_without_scheme_gets_http():
    assert apps._norm_url("192.168.0.100/blog/") == "http://192.168.0.100/blog"
    assert apps._norm_url("https://x.test") == "https://x.test"


def test_validate_rules():
    wp = appcatalog.get("wordpress")
    base = {"admin_user": "piadmin", "admin_email": "a@b.co", "admin_pass": "Long-enough-pass1"}
    assert apps._validate(wp, base)["setup"] is True
    with pytest.raises(apps.AppError):
        apps._validate(wp, {**base, "admin_user": "admin"})
    with pytest.raises(apps.AppError):
        apps._validate(wp, {**base, "admin_pass": "short"})
    assert apps._validate(wp, {**base, "setup": False})["setup"] is False  # WordPress can finish in the browser
    concrete = appcatalog.get("concrete")
    assert apps._validate(concrete, {**base, "admin_user": ""})["admin_user"] == "admin"  # Concrete names it itself
    grav = appcatalog.get("grav")
    with pytest.raises(apps.AppError, match="upper"):
        apps._validate(grav, {**base, "admin_pass": "alllowercase-123"})
    drupal = appcatalog.get("drupal")
    assert apps._validate(drupal, {})["setup"] is False  # web installer: no admin fields needed


def test_unavailable_apps_are_refused():
    with pytest.raises(apps.AppError, match="PHP 7.4"):
        apps.install("owncloud", {})


def test_generated_password_meets_every_policy():
    for _ in range(50):
        p = apps._pw()
        assert len(p) >= 12 and any(c.isupper() for c in p) and any(c.islower() for c in p) and any(c.isdigit() for c in p)
        assert not set(p) & set("\"'\\ ")
