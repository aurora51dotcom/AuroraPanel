#!/bin/bash
# Run the test suite + coverage on this Pi, against the real system.
#
#   sudo bash tests/run.sh            # all tests, coverage report in htmlcov/index.html
#   sudo bash tests/run.sh -k sites   # only tests matching "sites"
#
# Runs as root (like the panel) so every page can read the system. The tests
# use a throwaway login/config and a temp File Manager folder, and only call
# read-only pages — nothing on the Pi is changed.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -x .venv/bin/python ] || { echo "Run install.sh first (needs .venv)"; exit 1; }
.venv/bin/python -m pip install -q -r requirements-dev.txt
export AURORA_TEST_TMP="$(mktemp -d /tmp/aurora-tests.XXXXXX)"
trap 'rm -rf "$AURORA_TEST_TMP"' EXIT
.venv/bin/python -m pytest "$@"
echo
echo "Coverage report: $(pwd)/htmlcov/index.html"
