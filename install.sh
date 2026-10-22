#!/usr/bin/env bash
# AuroraPanel installer — Raspberry Pi OS / Debian / Ubuntu.
#
#   sudo bash install.sh                 # interactive: asks which port
#   sudo bash install.sh --port 9000     # non-interactive
#   sudo bash install.sh --uninstall     # remove the service (keeps files)
#
# Installs in place (the folder this script lives in): creates .venv, installs
# Python deps, and registers a systemd service "aurorapanel" that starts on
# boot. Re-run it any time to change the port or repair the install — your
# admin account (aurora_config.json) and custom AURORA_* settings are kept.
set -euo pipefail

SERVICE=aurorapanel
UNIT="/etc/systemd/system/${SERVICE}.service"
DEFAULT_PORT=8088
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ORIG_ARGS=("$@")
PORT=""
ASSUME_YES=0
UNINSTALL=0

c_ok=$'\e[32m'; c_warn=$'\e[33m'; c_err=$'\e[31m'; c_hi=$'\e[1;38;5;208m'; c_off=$'\e[0m'
[ -t 1 ] || { c_ok=; c_warn=; c_err=; c_hi=; c_off=; }
say()  { echo "${c_hi}==>${c_off} $*"; }
ok()   { echo "${c_ok}  ✓${c_off} $*"; }
warn() { echo "${c_warn}  !${c_off} $*"; }
die()  { echo "${c_err}  ✗ $*${c_off}" >&2; exit 1; }

usage() {
  sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    -p|--port)   PORT="${2:-}"; shift 2 ;;
    --port=*)    PORT="${1#*=}"; shift ;;
    -y|--yes)    ASSUME_YES=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help)   usage ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

# --- root -------------------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null || die "Run this as root."
  exec sudo bash "$0" "${ORIG_ARGS[@]}"
fi

# The regular user who ran sudo (File Manager defaults to their home).
PANEL_USER="${SUDO_USER:-}"
[ "$PANEL_USER" = "root" ] && PANEL_USER=""

# --- uninstall --------------------------------------------------------------
if [ $UNINSTALL = 1 ]; then
  # Started from the panel's own Terminal, this shell lives in the service's cgroup:
  # stopping the service kills this script halfway (unit file left behind). Hand the
  # job to a transient unit outside the panel and let it finish there.
  if [ -z "${AURORA_DETACHED:-}" ] && grep -q "/${SERVICE}\.service" /proc/self/cgroup 2>/dev/null; then
    warn "Running inside AuroraPanel's Terminal — the panel and this terminal will close."
    systemd-run --quiet --collect --unit="${SERVICE}-uninstall" --setenv=AURORA_DETACHED=1 \
      /bin/bash "${APP_DIR}/$(basename "${BASH_SOURCE[0]}")" --uninstall \
      || die "Could not start the uninstall in the background."
    ok "Uninstall continues in the background. Check it with: journalctl -u ${SERVICE}-uninstall"
    exit 0
  fi
  say "Removing the ${SERVICE} service"
  OLD_PORT=""
  [ -f "$UNIT" ] && OLD_PORT="$(sed -n 's/^Environment=PORT=\([0-9]*\).*/\1/p' "$UNIT" | head -n1)"
  systemctl disable --now "$SERVICE" 2>/dev/null || true
  rm -f "$UNIT" "/etc/systemd/system/${SERVICE}.service.d/aurora-https.conf" "/etc/letsencrypt/renewal-hooks/deploy/${SERVICE}-restart"
  rmdir "/etc/systemd/system/${SERVICE}.service.d" 2>/dev/null || true
  systemctl daemon-reload
  systemctl reset-failed "$SERVICE" 2>/dev/null || true
  ok "Service removed"
  if [ -n "$OLD_PORT" ] && command -v ufw >/dev/null && ufw status 2>/dev/null | grep -qE "^${OLD_PORT}/tcp"; then
    ufw delete allow "${OLD_PORT}/tcp" >/dev/null && ok "Removed the ufw rule for ${OLD_PORT}/tcp"
  fi
  # Helpers the panel set up (bans, monitor, VPN NAT) keep running on purpose — list them.
  LEFT="$(systemctl list-unit-files 'aurora-*' --no-legend 2>/dev/null | awk '{print $1}' | tr '\n' ' ')"
  [ -n "$LEFT" ] && warn "Still installed (used by fail2ban/VPN features, not removed): ${LEFT}"
  ok "Files in ${APP_DIR} were left untouched (delete the folder to remove AuroraPanel completely)."
  exit 0
fi

echo
echo "${c_hi}  AuroraPanel installer${c_off}"
echo "  Installing from: ${APP_DIR}"
echo

[ -f "$APP_DIR/backend/app.py" ] || die "backend/app.py not found — run this from the AuroraPanel folder."
command -v systemctl >/dev/null || die "systemd is required."

# --- port -------------------------------------------------------------------
# Default to the currently-installed port on a re-run.
CURRENT_PORT=""
if [ -f "$UNIT" ]; then
  CURRENT_PORT="$(sed -n 's/^Environment=PORT=\([0-9]*\).*/\1/p' "$UNIT" | head -n1)"
fi
SUGGESTED="${CURRENT_PORT:-$DEFAULT_PORT}"

port_in_use() {
  # Our own service holding its current port doesn't count.
  [ "$1" = "$CURRENT_PORT" ] && systemctl is-active --quiet "$SERVICE" && return 1
  ss -Hltn "sport = :$1" 2>/dev/null | grep -q .
}

valid_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

check_port() {
  valid_port "$1" || { warn "\"$1\" is not a valid port (1-65535)."; return 1; }
  if port_in_use "$1"; then
    local who
    who="$(ss -Hltnp "sport = :$1" 2>/dev/null | grep -o 'users:(("[^"]*' | head -n1 | cut -d'"' -f2)"
    warn "Port $1 is already in use${who:+ by $who}."
    return 1
  fi
  case "$1" in
    22)     warn "Port 22 is SSH."; return 1 ;;
    80|443) warn "Port $1 is normally used by the web server (Apache) — pick another." ; return 1 ;;
  esac
  return 0
}

if [ -n "$PORT" ]; then
  check_port "$PORT" || die "Choose a different port with --port."
elif [ $ASSUME_YES = 1 ] || [ ! -t 0 ]; then
  PORT="$SUGGESTED"
  check_port "$PORT" || die "Port $PORT is unavailable. Re-run with --port <number>."
else
  while :; do
    read -r -p "  Which port should AuroraPanel listen on? [${SUGGESTED}]: " PORT
    PORT="${PORT:-$SUGGESTED}"
    check_port "$PORT" && break
  done
fi
ok "Using port ${PORT}"

# --- system packages --------------------------------------------------------
say "Checking system packages"
NEED=()
command -v python3 >/dev/null || NEED+=(python3)
python3 -c 'import venv, ensurepip' 2>/dev/null || NEED+=(python3-venv)
command -v ss >/dev/null || NEED+=(iproute2)
command -v curl >/dev/null || NEED+=(curl)
if [ ${#NEED[@]} -gt 0 ]; then
  command -v apt-get >/dev/null || die "Missing: ${NEED[*]} — install them and re-run."
  say "Installing: ${NEED[*]}"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${NEED[@]}" >/dev/null
fi
PYV="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' || die "Python 3.10+ required (found $PYV)."
ok "Python $PYV"

# --- virtualenv + deps ------------------------------------------------------
say "Setting up Python environment"
cd "$APP_DIR"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv || die "Could not create .venv (is python3-venv installed?)."
fi
.venv/bin/python -m pip install --quiet --upgrade pip
if ! .venv/bin/python -m pip install --quiet -r requirements.txt; then
  # No prebuilt wheel for this Pi (e.g. 32-bit / older OS) — build from source.
  command -v apt-get >/dev/null || die "pip install failed."
  warn "Prebuilt packages unavailable — installing build tools and retrying (this can take a while on older Pis)"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq build-essential python3-dev libffi-dev >/dev/null
  .venv/bin/python -m pip install --quiet -r requirements.txt || die "pip install failed — see errors above."
fi
ok "Dependencies installed"

# --- systemd unit -----------------------------------------------------------
say "Writing ${UNIT}"
# Keep any custom AURORA_* settings from a previous install.
EXTRA_ENV=""
if [ -f "$UNIT" ]; then
  EXTRA_ENV="$(grep -E '^Environment=AURORA_' "$UNIT" | grep -v '^Environment=AURORA_USER=' || true)"
fi

cat > "$UNIT" <<EOF
# Generated by AuroraPanel install.sh — re-run the installer to change the port.
[Unit]
Description=AuroraPanel - Raspberry Pi control panel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}
Environment=HOST=0.0.0.0
Environment=PORT=${PORT}
${PANEL_USER:+Environment=AURORA_USER=${PANEL_USER}}
${EXTRA_ENV}
ExecStart=${APP_DIR}/.venv/bin/python -m uvicorn backend.app:app --host 0.0.0.0 --port ${PORT}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
# Drop the blank lines left by empty optional entries.
sed -i '/^$/N;/^\n$/D' "$UNIT"

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"
ok "Service enabled (starts on boot)"

# --- firewall ---------------------------------------------------------------
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "${PORT}/tcp" >/dev/null
  ok "ufw is active — allowed ${PORT}/tcp"
  if [ -n "$CURRENT_PORT" ] && [ "$CURRENT_PORT" != "$PORT" ]; then
    warn "The old panel port ${CURRENT_PORT}/tcp is still allowed in ufw (remove it with: sudo ufw delete allow ${CURRENT_PORT}/tcp)"
  fi
fi

# --- health check -----------------------------------------------------------
say "Waiting for AuroraPanel to start"
# Panel HTTPS (Security page) is a drop-in that this unit rewrite leaves in place.
SCHEME=http
grep -qs '^Environment=UVICORN_SSL_CERTFILE=' "/etc/systemd/system/${SERVICE}.service.d/aurora-https.conf" && SCHEME=https
UP=0
for _ in $(seq 1 30); do
  if curl -fsk -o /dev/null "${SCHEME}://127.0.0.1:${PORT}/"; then UP=1; break; fi
  sleep 1
done
if [ $UP = 0 ]; then
  warn "The panel did not answer on port ${PORT}. Recent logs:"
  journalctl -u "$SERVICE" -n 25 --no-pager || true
  die "Install finished but the service isn't responding."
fi
ok "Panel is up"

IPS="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' || true)"
echo
echo "${c_hi}  AuroraPanel is installed!${c_off}"
echo
echo "  Open it from a browser on your network:"
for ip in $IPS; do echo "    ${SCHEME}://${ip}:${PORT}"; done
echo "    ${SCHEME}://$(hostname).local:${PORT}"
echo
if [ ! -f "$APP_DIR/aurora_config.json" ]; then
  echo "  First visit: you'll be asked to create your admin account."
fi
echo "  Change the port later:  sudo bash ${APP_DIR}/install.sh"
echo "  Logs:                   sudo journalctl -u ${SERVICE} -f"
echo "  Uninstall service:      sudo bash ${APP_DIR}/install.sh --uninstall"
echo
