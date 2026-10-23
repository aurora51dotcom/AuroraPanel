"""Frontend: every script parses, and the API helpers point at routes that exist."""
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from backend.app import app

JS = sorted((Path(__file__).resolve().parent.parent / "frontend" / "js").glob("*.js"))


@pytest.mark.skipif(not shutil.which("node"), reason="Node.js not installed")
@pytest.mark.parametrize("path", JS, ids=lambda p: p.name)
def test_js_parses(path):
    r = subprocess.run(["node", "--check", str(path)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_api_js_routes_exist():
    api = (Path(__file__).resolve().parent.parent / "frontend" / "js" / "api.js").read_text(encoding="utf-8")
    routes = [re.compile("^" + re.sub(r"\{[^}]+\}", "[^/]+", r.path) + "$") for r in app.routes if hasattr(r, "path")]
    used = set()
    for m in re.finditer(r"[\"'`](/api/[^\"'`?]*)", api):
        path = re.sub(r"\$\{[^}]+\}", "x", m.group(1)).rstrip("/")
        if path:
            used.add(path)
    missing = sorted(p for p in used if not any(rx.match(p) for rx in routes))
    assert not missing, f"api.js calls routes the backend doesn't have: {missing}"
