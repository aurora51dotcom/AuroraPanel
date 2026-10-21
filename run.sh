#!/usr/bin/env bash
# AuroraPanel — Linux / Raspberry Pi launcher
set -e
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8088}"
echo
echo "AuroraPanel running at http://${HOST}:${PORT}"
echo
exec python -m uvicorn backend.app:app --host "$HOST" --port "$PORT"
