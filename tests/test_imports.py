"""Every backend module imports (catches syntax errors and broken imports anywhere)."""
import importlib
from pathlib import Path

import pytest

MODULES = sorted(p.stem for p in (Path(__file__).resolve().parent.parent / "backend").glob("*.py") if p.stem != "__init__")


@pytest.mark.parametrize("name", MODULES)
def test_module_imports(name):
    importlib.import_module(f"backend.{name}")
