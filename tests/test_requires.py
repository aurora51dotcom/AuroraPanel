"""Requirements: the component catalog is consistent, and apt progress drives job bars."""
import pytest

from backend import jobs, requires


def test_components_are_complete():
    for cid, c in requires.COMPONENTS.items():
        assert c["name"] and c["desc"] and c["size"] and c["icon"], cid
        pkgs = c["pkgs"] if not callable(c["pkgs"]) else ["docker.io"]  # docker picks its compose package per OS
        assert pkgs and all(isinstance(p, str) and p for p in pkgs), cid
        assert callable(c["check"]), cid
        for n in c.get("needs", []):
            assert n in requires.COMPONENTS and n != cid, cid


def test_unknown_component_is_refused():
    with pytest.raises(requires.RequiresError):
        requires.install("rm -rf /")


def test_status_skips_unknown_ids(monkeypatch):
    monkeypatch.setattr(requires, "installed", lambda cid: cid == "git")
    st = requires.status(["git", "web", "nope"])
    assert set(st["components"]) == {"git", "web"}
    assert st["components"]["git"]["installed"] is True and st["components"]["web"]["installed"] is False


def test_apt_gets_progress_and_lock_options():
    argv = jobs._with_apt_progress(["apt-get", "-y", "install", "git"])
    assert "APT::Status-Fd=1" in argv and "DPkg::Lock::Timeout=600" in argv and argv[-1] == "git"
    # an explicit lock timeout is kept, other commands are untouched
    argv = jobs._with_apt_progress(["apt-get", "-o", "DPkg::Lock::Timeout=5", "install", "x"])
    assert argv.count("DPkg::Lock::Timeout=600") == 0
    assert jobs._with_apt_progress(["ls", "-l"]) == ["ls", "-l"]


def test_apt_status_lines_move_the_bar():
    job = jobs.Job("t", [])
    assert not jobs.apt_status(job, "Setting up git (1:2.47) ...")
    assert jobs.apt_status(job, "dlstatus:git:50.0:Retrieving file 3 of 6")
    assert job.progress == pytest.approx(jobs.DL_SHARE / 2) and job.stage == "Retrieving file 3 of 6"
    assert jobs.apt_status(job, "pmstatus:git:100:Installed git")
    assert job.progress == 100
    # a span maps into part of the bar, and the bar never moves backwards
    job2 = jobs.Job("t", [])
    jobs.apt_status(job2, "pmstatus:x:50:Unpacking x", (10, 20))
    assert job2.progress == pytest.approx(10 + 10 * (jobs.DL_SHARE + 50 * (100 - jobs.DL_SHARE) / 100) / 100)
    before = job2.progress
    jobs.apt_status(job2, "dlstatus:x:0:Downloading", (10, 20))
    assert job2.progress == before
