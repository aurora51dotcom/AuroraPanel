"""A tiny in-memory background job runner for long-running commands
(apt updates, backups, restores). Each job streams stdout+stderr into a buffer
that the frontend polls.

Jobs are ephemeral (lost on restart) which is fine for interactive use.
"""
from __future__ import annotations

import subprocess
import threading
import time
import uuid
from collections import deque
from typing import Sequence

_jobs: dict[str, "Job"] = {}
_lock = threading.Lock()
_MAX_JOBS = 50


class Job:
    def __init__(self, title: str, argv: Sequence[str], meta: dict | None = None):
        self.id = uuid.uuid4().hex[:12]
        self.title = title
        self.argv = list(argv)
        self.lines: deque[str] = deque(maxlen=20000)
        self.status = "running"  # running | done | failed
        self.returncode: int | None = None
        self.started = time.time()
        self.finished: float | None = None
        self.meta = meta or {}
        self._thread: threading.Thread | None = None

    def to_dict(self, tail: int | None = None) -> dict:
        lines = list(self.lines)
        if tail is not None:
            lines = lines[-tail:]
        return {
            "id": self.id,
            "title": self.title,
            "status": self.status,
            "returncode": self.returncode,
            "started": self.started,
            "finished": self.finished,
            "output": "\n".join(lines),
            "line_count": len(self.lines),
            "meta": self.meta,
        }

    def _run(self, env: dict | None):
        try:
            proc = subprocess.Popen(
                self.argv,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                env=env,
            )
            assert proc.stdout is not None
            for line in proc.stdout:
                self.lines.append(line.rstrip("\n"))
            proc.wait()
            self.returncode = proc.returncode
            ok_codes = self.meta.get("ok_returncodes", [0])
            self.status = "done" if proc.returncode in ok_codes else "failed"
        except (OSError, subprocess.SubprocessError) as exc:
            self.lines.append(f"[runner error] {exc}")
            self.status = "failed"
            self.returncode = -1
        finally:
            self.finished = time.time()

    def start(self, env: dict | None = None):
        self._thread = threading.Thread(target=self._run, args=(env,), daemon=True)
        self._thread.start()


def launch(title: str, argv: Sequence[str], env: dict | None = None, meta: dict | None = None) -> Job:
    job = Job(title, argv, meta=meta)
    with _lock:
        # Evict oldest finished jobs if we hit the cap.
        if len(_jobs) >= _MAX_JOBS:
            for jid in list(_jobs):
                if _jobs[jid].status != "running":
                    del _jobs[jid]
                    break
        _jobs[job.id] = job
    job.start(env=env)
    return job


class FnJob(Job):
    """A job that runs a Python function; fn(log) writes progress via log(str)."""

    def __init__(self, title: str, fn, meta: dict | None = None):
        super().__init__(title, [], meta=meta)
        self.fn = fn
        self.result = None

    def _run(self, env):
        try:
            self.result = self.fn(self.lines.append)
            self.returncode, self.status = 0, "done"
        except Exception as exc:  # surfaced to the UI as the job's last line
            self.lines.append(f"✖ {exc}")
            self.returncode, self.status = 1, "failed"
        finally:
            self.finished = time.time()

    def to_dict(self, tail: int | None = None) -> dict:
        d = super().to_dict(tail)
        d["result"] = self.result
        return d


def launch_fn(title: str, fn, meta: dict | None = None) -> Job:
    job = FnJob(title, fn, meta=meta)
    with _lock:
        if len(_jobs) >= _MAX_JOBS:
            for jid in list(_jobs):
                if _jobs[jid].status != "running":
                    del _jobs[jid]
                    break
        _jobs[job.id] = job
    job.start()
    return job


def get(job_id: str) -> Job | None:
    return _jobs.get(job_id)


def listing() -> list[dict]:
    with _lock:
        jobs = sorted(_jobs.values(), key=lambda j: j.started, reverse=True)
    return [j.to_dict(tail=1) for j in jobs]
