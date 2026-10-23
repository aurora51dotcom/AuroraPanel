"""Update check: version ordering (a wrong order means Pis never get offered an update)."""
from backend import version


def test_numeric_order():
    k = version._key
    assert k("1.0.10-beta") > k("1.0.9-beta")
    assert k("1.1.0-beta") > k("1.0.10-beta")
    assert k("1.0.0") > k("1.0.0-beta")  # a final release beats its beta


def test_current_version_is_valid():
    assert version._key(version.VERSION)
