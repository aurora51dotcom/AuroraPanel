"""Crontab management via the `crontab` command.

Operates on the crontab of the user the panel runs as (root, in the systemd
deployment). Entries are parsed into schedule + command; comments/env lines are
preserved on write.

Panel extras, stored as plain crontab comments so the file stays valid cron:
  * label  — a `# aurora: <label>` line directly above the job
  * paused — the job line prefixed with `#paused: ` (cron ignores it)
"""
from __future__ import annotations

import platform
import re
import shutil
import subprocess
from datetime import datetime

from . import jobs as jobrunner

IS_LINUX = platform.system() == "Linux"

LABEL_PREFIX = "# aurora:"
PAUSE_PREFIX = "#paused: "
MACROS = {"@reboot", "@yearly", "@annually", "@monthly", "@weekly", "@daily", "@midnight", "@hourly"}
_FIELD_RE = re.compile(r"^[\d*/,\-A-Za-z]+$")


class CronError(RuntimeError):
    pass


def _require_cron():
    if not IS_LINUX or not shutil.which("crontab"):
        raise CronError("crontab is not available on this host")


def _read_raw() -> str:
    out = subprocess.run(["crontab", "-l"], capture_output=True, text=True, timeout=10)
    # rc 1 with "no crontab for" simply means an empty crontab.
    if out.returncode != 0 and "no crontab" not in (out.stderr or "").lower():
        if out.stdout.strip():
            raise CronError(out.stderr.strip() or "Failed to read crontab")
    return out.stdout


def _write_raw(content: str) -> None:
    if not content.endswith("\n"):
        content += "\n"
    proc = subprocess.run(["crontab", "-"], input=content, text=True, capture_output=True, timeout=10)
    if proc.returncode != 0:
        raise CronError(proc.stderr.strip() or "Failed to write crontab")


def _parse_entry(text: str) -> tuple[str, str] | None:
    """Split an (unprefixed) crontab entry into (schedule, command)."""
    if text.startswith("@"):
        parts = text.split(None, 1)
        return parts[0], parts[1] if len(parts) > 1 else ""
    parts = text.split(None, 5)
    if len(parts) < 6:
        return None
    return " ".join(parts[:5]), parts[5]


def validate_schedule(schedule: str) -> str:
    s = " ".join((schedule or "").split())
    if not s:
        raise CronError("Schedule is required")
    if s.startswith("@"):
        if s not in MACROS:
            raise CronError(f"Unknown macro {s}")
        return s
    fields = s.split(" ")
    if len(fields) != 5:
        raise CronError("Schedule needs 5 fields: minute hour day month weekday")
    for f, spec in zip(fields, _SPECS):
        if not _FIELD_RE.match(f):
            raise CronError(f"Invalid field '{f}'")
        _check_field(f, *spec)
    return s


_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
_DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
# (name, min, max, names, name offset)
_SPECS = [("minute", 0, 59, None, 0), ("hour", 0, 23, None, 0), ("day-of-month", 1, 31, None, 0),
          ("month", 1, 12, _MONTHS, 1), ("day-of-week", 0, 7, _DAYS, 0)]


def _check_field(text: str, name: str, lo: int, hi: int, names, offset: int) -> None:
    def val(tok: str) -> int:
        if names and tok.upper() in names:
            return names.index(tok.upper()) + offset
        if not tok.isdigit():
            raise CronError(f"'{tok}' isn't a valid {name}")
        n = int(tok)
        if not lo <= n <= hi:
            raise CronError(f"{name} must be between {lo} and {hi}")
        return n

    for part in text.split(","):
        rng, _, step = part.partition("/")
        if "/" in step or (part.count("/") and not step.isdigit()) or (step and int(step) == 0):
            raise CronError(f"Bad step in '{part}'")
        if rng == "*":
            continue
        a, _, b = rng.partition("-")
        if b and val(a) > val(b):
            raise CronError(f"Range {rng} goes backwards")
        val(a)


def _clean(text: str, what: str) -> str:
    text = (text or "").strip()
    if "\n" in text or "\r" in text:
        raise CronError(f"Newlines are not allowed in the {what}")
    return text


def _tz() -> dict:
    now = datetime.now().astimezone()
    off = now.utcoffset()
    return {"tz": now.tzname(), "utc_offset_min": int(off.total_seconds() // 60) if off else 0}


def list_jobs() -> dict:
    if not IS_LINUX or not shutil.which("crontab"):
        return {"jobs": [], "raw": "", "supported": False, **_tz()}
    raw = _read_raw()
    out = []
    label = None
    for idx, line in enumerate(raw.splitlines()):
        stripped = line.strip()
        if stripped.startswith(LABEL_PREFIX):
            label = stripped[len(LABEL_PREFIX):].strip() or None
            continue
        paused = stripped.startswith(PAUSE_PREFIX)
        body = stripped[len(PAUSE_PREFIX):].strip() if paused else stripped
        if not body or (body.startswith("#") and not paused):
            label = None
            continue
        head = body.split("=", 1)[0]
        if "=" in body and head.isupper() and " " not in head:
            label = None
            continue  # env assignment like SHELL=/bin/sh
        parsed = _parse_entry(body)
        if not parsed:
            label = None
            continue
        schedule, command = parsed
        out.append({"line": idx, "schedule": schedule, "command": command, "raw": stripped,
                    "label": label, "paused": paused})
        label = None
    return {"jobs": out, "raw": raw, **_tz()}


def _format(schedule: str, command: str, label: str | None, paused: bool = False) -> list[str]:
    lines = []
    if label:
        lines.append(f"{LABEL_PREFIX} {label}")
    entry = f"{schedule} {command}"
    lines.append(PAUSE_PREFIX + entry if paused else entry)
    return lines


def add_job(schedule: str, command: str, label: str | None = None) -> dict:
    _require_cron()
    schedule = validate_schedule(_clean(schedule, "schedule"))
    command = _clean(command, "command")
    label = _clean(label or "", "label") or None
    if not command:
        raise CronError("Command is required")
    raw = _read_raw()
    lines = raw.rstrip("\n").splitlines() if raw.strip() else []
    lines += _format(schedule, command, label)
    _write_raw("\n".join(lines))
    return {"ok": True}


def _locate(lines: list[str], target: str) -> int:
    for i, line in enumerate(lines):
        if line.strip() == target:
            return i
    raise CronError("Matching cron entry not found (was it changed elsewhere?)")


def _replace(raw_line: str, new_lines: list[str] | None) -> None:
    """Replace (or delete when new_lines is None) a job and its label line."""
    _require_cron()
    target = (raw_line or "").strip()
    if not target:
        raise CronError("No line specified")
    lines = _read_raw().splitlines()
    i = _locate(lines, target)
    start = i - 1 if i > 0 and lines[i - 1].strip().startswith(LABEL_PREFIX) else i
    lines[start:i + 1] = new_lines or []
    _write_raw("\n".join(lines))


def delete_job(raw_line: str) -> dict:
    _replace(raw_line, None)
    return {"ok": True, "removed": raw_line}


def update_job(raw_line: str, schedule: str, command: str, label: str | None = None, paused: bool = False) -> dict:
    schedule = validate_schedule(_clean(schedule, "schedule"))
    command = _clean(command, "command")
    label = _clean(label or "", "label") or None
    if not command:
        raise CronError("Command is required")
    _replace(raw_line, _format(schedule, command, label, paused))
    return {"ok": True}


def set_paused(raw_line: str, paused: bool) -> dict:
    target = (raw_line or "").strip()
    job = next((j for j in list_jobs()["jobs"] if j["raw"] == target), None)
    if not job:
        raise CronError("Matching cron entry not found")
    return update_job(target, job["schedule"], job["command"], job["label"], paused)


def run_now(raw_line: str) -> dict:
    _require_cron()
    target = (raw_line or "").strip()
    job = next((j for j in list_jobs()["jobs"] if j["raw"] == target), None)
    if not job:
        raise CronError("Matching cron entry not found")
    title = f"Run: {job['label'] or job['command'][:40]}"
    j = jobrunner.launch(title, ["/bin/sh", "-c", job["command"]])
    return {"job_id": j.id}
