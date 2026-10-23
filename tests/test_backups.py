"""Backups: names, categories, the index, and (on Linux) a real back-up → restore round trip."""
import gzip
import io
import json
import sys
import tarfile
import time

import pytest

from backend import backups, jobs

linux = pytest.mark.skipif(not sys.platform.startswith("linux"), reason="needs GNU tar (the panel runs on a Pi)")


@pytest.fixture
def bdir(tmp_path, monkeypatch):
    d = tmp_path / "backups"
    d.mkdir()
    monkeypatch.setattr(backups, "BACKUP_DIR", d.resolve())
    monkeypatch.setattr(backups, "_my_ok", lambda: False)
    monkeypatch.setattr(backups, "_pg_ready", lambda: False)
    return d.resolve()


def _tar(path, members: dict):
    with tarfile.open(path, "w:gz") as tf:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))


def _wait(job, timeout=60):
    end = time.time() + timeout
    while job.status == "running" and time.time() < end:
        time.sleep(0.05)
    return job


def test_safe_label():
    assert backups._safe_label("CBT Nuggets - White Hat (v10)") == "CBT-Nuggets-White-Hat-v10"
    assert backups._safe_label("   ") == "backup"


def test_names_with_spaces_are_valid(bdir):
    name = "CBT Nuggets - White Hat Hacking v10 (CEH v10)-20260928-005225.tar.gz"
    _tar(bdir / name, {"CBT/a.txt": b"x"})
    assert backups._archive_path(name).name == name


@pytest.mark.parametrize("bad", ["../x.tar.gz", "a/b.tar.gz", ".aurora-index.json", ".partial-x.tar.gz", "x.txt", ""])
def test_bad_names_refused(bdir, bad):
    with pytest.raises(backups.BackupError):
        backups._archive_path(bad)


def test_categories(bdir):
    _tar(bdir / "site-20260101-000000.tar.gz", {"site/index.html": b"hi"})
    man = {"kind": "databases", "paths": [], "mysql": ["shop"], "pgsql": ["crm"], "created": 1, "host": "pi"}
    _tar(bdir / "db-20260101-000000.tar.gz", {"manifest.json": json.dumps(man).encode(), "databases/mysql/shop.sql": b"--"})
    man_full = {**man, "kind": "full", "paths": ["/home/a51"]}
    _tar(bdir / "full-20260101-000000.tar.gz", {"manifest.json": json.dumps(man_full).encode()})
    with gzip.open(bdir / "mysql-shop-20260101-000000.sql.gz", "wb") as fh:
        fh.write(b"-- MariaDB dump 10.19\n")
    (bdir / "export.sql").write_text("-- PostgreSQL database dump\n")
    (bdir / ".partial-hidden.tar.gz").write_bytes(b"")

    got = {b["name"]: b for b in backups.list_backups()["backups"]}
    assert set(got) == {"site-20260101-000000.tar.gz", "db-20260101-000000.tar.gz", "full-20260101-000000.tar.gz",
                        "mysql-shop-20260101-000000.sql.gz", "export.sql"}
    assert got["site-20260101-000000.tar.gz"]["kind"] == "plain" and got["site-20260101-000000.tar.gz"]["top"] == "site"
    assert got["db-20260101-000000.tar.gz"]["category"] == "databases"
    assert got["db-20260101-000000.tar.gz"]["pgsql"] == ["crm"]
    assert got["full-20260101-000000.tar.gz"]["category"] == "full"
    assert got["mysql-shop-20260101-000000.sql.gz"]["engine"] == "mysql"
    assert got["mysql-shop-20260101-000000.sql.gz"]["db"] == "shop"
    assert got["export.sql"]["engine"] == "pgsql"
    assert got["export.sql"]["db"] == "export" and got["export.sql"]["db_guessed"] is True
    # The index is written so the next listing doesn't reopen the archives.
    assert "site-20260101-000000.tar.gz" in json.loads((bdir / ".aurora-index.json").read_text())


def test_plain_restore_refuses_wizard_archives(bdir):
    _tar(bdir / "w.tar.gz", {"manifest.json": json.dumps({"kind": "files", "paths": ["/x"], "mysql": [], "pgsql": []}).encode()})
    with pytest.raises(backups.BackupError, match="Wizard"):
        backups.restore_backup("w.tar.gz", "/tmp")


def test_upload_rejects_wrong_type(bdir):
    with pytest.raises(backups.BackupError):
        backups.upload_target("notes.txt")
    tmp, final = backups.upload_target("My Shop Export.sql.gz")
    assert final.name == "My-Shop-Export.sql.gz"
    tmp.write_bytes(b"not gzip")
    with pytest.raises(backups.BackupError, match="gzip"):
        backups.finish_upload(tmp, final)
    assert not tmp.exists() and not final.exists()


@linux
def test_round_trip_with_progress_and_parallel_restores(bdir, tmp_path):
    src = tmp_path / "My Site"
    (src / "sub").mkdir(parents=True)
    (src / "sub" / "page.html").write_text("hello")
    job = _wait(backups.create_backup(str(src)))
    assert job.status == "done", list(job.lines)
    assert job.progress == 100
    made = job.result["name"]
    assert made.startswith("My-Site-")  # spaces cleaned from the auto name
    info = {b["name"]: b for b in backups.list_backups()["backups"]}[made]
    assert info["parent"] == str(tmp_path) and info["guessed"] is False

    # Two restores of different archives run side by side; the same archive twice is refused.
    other = _wait(backups.create_backup(str(src), "second")).result["name"]
    d1, d2 = tmp_path / "r1", tmp_path / "r2"
    d1.mkdir(); d2.mkdir()
    j1 = backups.restore_backup(made, str(d1))
    j2 = backups.restore_backup(other, str(d2))
    _wait(j1); _wait(j2)
    assert j1.status == j2.status == "done"
    assert (d1 / "My Site" / "sub" / "page.html").read_text() == "hello"
    assert (d2 / "My Site" / "sub" / "page.html").read_text() == "hello"
    assert any(j["id"] == j1.id for j in backups.backup_jobs()["jobs"])

    # Default destination = where it came from.
    (src / "sub" / "page.html").write_text("changed")
    _wait(backups.restore_backup(made))
    assert (src / "sub" / "page.html").read_text() == "hello"


def test_same_archive_busy_is_refused(bdir):
    import threading
    gate = threading.Event()
    held = backups._launch("hold", "restore", "x.tar.gz", lambda log: gate.wait(10))
    try:
        with pytest.raises(backups.BackupError, match="already being restored"):
            backups._launch("again", "restore", "x.tar.gz", lambda log: None)
        other = _wait(backups._launch("other", "restore", "y.tar.gz", lambda log: None))
        assert other.status == "done"  # a different archive is fine meanwhile
    finally:
        gate.set()
        _wait(held)


def test_job_progress_reported():
    def fn(log):
        log.progress(40, "Half way")
        return {"ok": True}
    j = _wait(jobs.launch_fn("t", fn, meta={"area": "test-progress"}))
    d = j.to_dict()
    assert d["status"] == "done" and d["progress"] == 100 and d["stage"] == "Half way"
    assert jobs.find(area="test-progress")[0] is j
