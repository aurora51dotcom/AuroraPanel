"""AuroraPanel — a cPanel-style control panel for Raspberry Pi.

FastAPI backend: auth, system metrics, systemd services, processes, and a
sandboxed file manager. Serves the static frontend from ../frontend.
"""
from __future__ import annotations

import io
import json
import os
import threading
import time
from pathlib import Path

from fastapi import (
    Depends, FastAPI, File, Form, HTTPException, Request, UploadFile,
    WebSocket, WebSocketDisconnect,
)
from fastapi.responses import (
    FileResponse, HTMLResponse, JSONResponse, StreamingResponse,
)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import (
    antivirus, apache, apitokens, appmanager, auth, backups, config, cron,
    apps, databases, diskusage, dnszones, domains, fail2ban, netmgr, sites, files, firewall, ipblocker, jobs,
    modsecurity, netdiag, packages, perms, phpmgr, services, sslcerts, sshaccess,
    sysapps, system_info, terminal, twofa, users,
    appconfig, ddns, ftp, gitvc, guard, images, ipsec, webaccess, netmon, openvpn, phpsettings, portcheck, version, vpncommon, wireguard,
)

# The API schema is a full map of every endpoint, so it's off unless asked for.
_OPENAPI_URL = "/openapi.json" if os.environ.get("AURORA_ENABLE_OPENAPI") == "1" else None
app = FastAPI(title="AuroraPanel", version=version.VERSION,
              docs_url=None, redoc_url=None, openapi_url=_OPENAPI_URL)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
# Changes every process start (i.e. every deploy/restart). Injected into the
# frontend's asset URLs so browsers always fetch the current JS/CSS — a stale
# cached copy can never be reused because its URL no longer matches.
APP_VERSION = str(int(time.time()))


def _frontend_build() -> str:
    """Changes only when the panel's code does (unlike APP_VERSION, which changes on every
    restart): open tabs compare it to spot an update and offer a reload."""
    import hashlib
    h = hashlib.sha256(version.VERSION.encode())
    front = Path(__file__).resolve().parent.parent / "frontend"
    for f in sorted(front.rglob("*")):
        if f.suffix in (".js", ".css", ".html") and f.is_file():
            h.update(f"{f.relative_to(front)}:{f.stat().st_size}:{int(f.stat().st_mtime)}".encode())
    return h.hexdigest()[:12]


FRONTEND_BUILD = _frontend_build()


@app.middleware("http")
async def _no_stale_frontend(request, call_next):
    """Force browsers to revalidate HTML/JS/CSS so a redeploy is never masked by
    a stale cached script. StaticFiles answers the conditional GET with 304 when
    unchanged, so this stays cheap."""
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.endswith((".html", ".js", ".css")):
        response.headers["Cache-Control"] = "no-cache"
    if path.startswith("/api/"):
        response.headers["X-Aurora-Build"] = FRONTEND_BUILD
    # Defence in depth against XSS: even if untrusted text (log lines, usernames
    # from the Network Monitor…) ever reached innerHTML, no script could run —
    # only our own same-origin files are executable; no inline/eval, no plugins.
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; "
        "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    return response


def _render_index() -> HTMLResponse:
    html = (FRONTEND_DIR / "index.html").read_text(encoding="utf-8")
    html = html.replace("__V__", APP_VERSION).replace("__BUILD__", FRONTEND_BUILD)
    return HTMLResponse(html, headers={"Cache-Control": "no-cache"})


@app.get("/")
def index_root():
    return _render_index()


@app.get("/index.html")
def index_html():
    return _render_index()


# --------------------------------------------------------------------------- #
# Request models
# --------------------------------------------------------------------------- #
class LoginBody(BaseModel):
    username: str
    password: str
    otp: str | None = None


class SetupBody(BaseModel):
    username: str
    password: str


class ServiceBody(BaseModel):
    unit: str
    action: str


class WriteBody(BaseModel):
    path: str
    content: str


class PathBody(BaseModel):
    path: str


class MkdirBody(BaseModel):
    path: str
    name: str


# --------------------------------------------------------------------------- #
# Auth / setup
# --------------------------------------------------------------------------- #
@app.get("/api/status")
def api_status():
    """Public: tells the frontend whether first-run setup is needed."""
    return {"initialized": config.is_initialized()}


@app.post("/api/setup")
def api_setup(body: SetupBody):
    if config.is_initialized():
        raise HTTPException(status_code=409, detail="Already initialized")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if not body.username.strip():
        raise HTTPException(status_code=400, detail="Username required")
    config.set_credentials(body.username.strip(), body.password)
    return {"ok": True}


def _auth_log(ok: bool, username: str, request: Request):
    """One journal line per login attempt, read back by the Network Monitor.
    The username is JSON-encoded so it can't inject fake log lines."""
    ip = request.client.host if request.client else "?"
    print(f"aurora-auth: {'ok' if ok else 'fail'} user={json.dumps(username[:64])} ip={ip}", flush=True)


# Per-IP login throttle (fail2ban still bans at the firewall; this works without it).
# Each attempt is counted when it STARTS, so a burst of parallel requests can't
# all slip past the check while the (slow) password hash runs.
_LOGIN_WINDOW = 15 * 60
_LOGIN_MAX_FAILS = 10
_LOGIN_MAX_IPS = 10000
_login_fails: dict[str, list[float]] = {}
_login_lock = threading.Lock()


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "?"


def _login_begin(ip: str) -> int:
    """Count one attempt for this IP. Returns seconds to wait if it's over the
    limit (the attempt is then not counted), else 0."""
    now = time.time()
    with _login_lock:
        recent = [t for t in _login_fails.pop(ip, []) if now - t < _LOGIN_WINDOW]
        if len(recent) >= _LOGIN_MAX_FAILS:
            _login_fails[ip] = recent
            return int(_LOGIN_WINDOW - (now - recent[0])) + 1
        recent.append(now)
        _login_fails[ip] = recent  # re-inserted = most recently used
        # Bound memory by dropping the least recently used IPs, never the whole table.
        while len(_login_fails) > _LOGIN_MAX_IPS:
            _login_fails.pop(next(iter(_login_fails)))
    return 0


def _login_forgive(ip: str, everything: bool = False):
    """Take back the attempt counted by _login_begin (right password), or clear
    the IP entirely (successful login)."""
    with _login_lock:
        recent = _login_fails.get(ip)
        if not recent:
            return
        if everything:
            _login_fails.pop(ip, None)
        else:
            recent.pop()


def _is_https(request: Request) -> bool:
    if os.environ.get("AURORA_SECURE_COOKIES") == "1":
        return True
    proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return request.url.scheme == "https" or proto == "https"


def _set_session(resp: JSONResponse, request: Request, username: str):
    resp.set_cookie(
        auth.COOKIE_NAME, auth.issue_token(username),
        httponly=True, samesite="strict", max_age=auth.SESSION_TTL_SECONDS, path="/",
        secure=_is_https(request),
    )


@app.post("/api/login")
def api_login(body: LoginBody, request: Request):
    ip = _client_ip(request)
    wait = _login_begin(ip)
    if wait:
        raise HTTPException(status_code=429, detail=f"Too many failed logins. Try again in {(wait + 59) // 60} min.")
    if not config.verify_credentials(body.username, body.password):
        _auth_log(False, body.username, request)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if twofa.is_enabled():
        if not body.otp:
            # Right password, code still to come: don't count this one.
            _login_forgive(ip)
            # Signal the frontend to prompt for a 2FA code.
            raise HTTPException(status_code=401, detail="otp_required")
        if not twofa.verify_login(body.otp):
            _auth_log(False, body.username, request)
            raise HTTPException(status_code=401, detail="Invalid 2FA code")
    _login_forgive(ip, everything=True)
    _auth_log(True, body.username, request)
    resp = JSONResponse({"ok": True, "username": body.username})
    _set_session(resp, request, body.username)
    return resp


@app.post("/api/logout")
def api_logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.COOKIE_NAME, path="/")
    return resp


@app.get("/api/me")
def api_me(user: str = auth.CurrentUser):
    owner = files.default_user()
    return {"username": user,
            "system_user": owner.pw_name if owner else None,
            "home": owner.pw_dir if owner else None}


# --------------------------------------------------------------------------- #
# System metrics
# --------------------------------------------------------------------------- #
@app.get("/api/system/overview")
def api_overview(user: str = auth.CurrentUser):
    return system_info.overview()


@app.get("/api/system/disks")
def api_disks(user: str = auth.CurrentUser):
    return {"disks": system_info.disks()}


@app.get("/api/system/network")
def api_network(user: str = auth.CurrentUser):
    return system_info.networks()


# ---- Network manager (static IP, Wi-Fi, hotspot, hostname, LAN devices, ports) ----
def _panel(request: Request) -> tuple[str | None, int]:
    return request.url.hostname, request.url.port or (443 if request.url.scheme == "https" else 80)


def _net_call(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except netmgr.NetError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class NetIPv4Body(BaseModel):
    uuid: str
    method: str
    address: str = ""
    gateway: str = ""
    dns: list[str] = []


class WifiConnectBody(BaseModel):
    ssid: str
    password: str = ""
    device: str = ""
    hidden: bool = False


class NameBody(BaseModel):
    name: str


class HotspotBody(BaseModel):
    ssid: str
    password: str
    device: str = "wlan0"
    band: str = "bg"


class PendingBody(BaseModel):
    id: str


class RadioBody(BaseModel):
    on: bool


@app.get("/api/net/overview")
def api_net_overview(request: Request, user: str = auth.CurrentUser):
    return _net_call(netmgr.overview, _panel(request)[0])


@app.post("/api/net/ipv4")
def api_net_ipv4(body: NetIPv4Body, request: Request, user: str = auth.CurrentUser):
    host, port = _panel(request)
    return _net_call(netmgr.set_ipv4, body.uuid, body.method, body.address, body.gateway, body.dns, host, port)


@app.get("/api/net/wifi")
def api_net_wifi(rescan: bool = True, user: str = auth.CurrentUser):
    return _net_call(netmgr.wifi_scan, rescan)


@app.post("/api/net/wifi/connect")
def api_net_wifi_connect(body: WifiConnectBody, request: Request, user: str = auth.CurrentUser):
    host, port = _panel(request)
    return _net_call(netmgr.wifi_connect, body.ssid, body.password, body.device, body.hidden, host, port)


@app.post("/api/net/wifi/forget")
def api_net_wifi_forget(body: NameBody, user: str = auth.CurrentUser):
    return _net_call(netmgr.wifi_forget, body.name)


@app.post("/api/net/wifi/radio")
def api_net_wifi_radio(body: RadioBody, request: Request, user: str = auth.CurrentUser):
    return _net_call(netmgr.wifi_radio, body.on, _panel(request)[0])


@app.get("/api/net/hotspot")
def api_net_hotspot(user: str = auth.CurrentUser):
    return netmgr.hotspot_status()


@app.post("/api/net/hotspot/start")
def api_net_hotspot_start(body: HotspotBody, request: Request, user: str = auth.CurrentUser):
    return _net_call(netmgr.hotspot_start, body.ssid, body.password, body.device, body.band, _panel(request)[0])


@app.post("/api/net/hotspot/stop")
def api_net_hotspot_stop(user: str = auth.CurrentUser):
    return _net_call(netmgr.hotspot_stop)


@app.post("/api/net/hostname")
def api_net_hostname(body: NameBody, user: str = auth.CurrentUser):
    return _net_call(netmgr.set_hostname, body.name)


@app.get("/api/net/neighbours")
def api_net_neighbours(user: str = auth.CurrentUser):
    return netmgr.neighbours()


@app.get("/api/net/ports")
def api_net_ports(user: str = auth.CurrentUser):
    return netmgr.ports()


@app.get("/api/net/pending")
def api_net_pending(user: str = auth.CurrentUser):
    return {"pending": netmgr.pending_status()}


@app.post("/api/net/confirm")
def api_net_confirm(body: PendingBody):
    # Deliberately unauthenticated: after an IP change the login cookie belongs to the
    # old address. The one-time id (only shown to a logged-in user) is the credential,
    # and all it can do is *keep* a change the admin already made.
    return _net_call(netmgr.confirm, body.id)


@app.post("/api/net/revert")
def api_net_revert(body: PendingBody, user: str = auth.CurrentUser):
    return _net_call(netmgr.revert_now, body.id)


# ---- Applications ----
class WPInstallBody(BaseModel):
    options: dict


class AppRemoveBody(BaseModel):
    path: str
    drop_db: bool = True
    remove_site: bool = False


def _app_call(fn, *a):
    try:
        return fn(*a)
    except apps.AppError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/apps2/status")
def api_apps2_status(user: str = auth.CurrentUser):
    return apps.status()


@app.post("/api/apps2/wordpress")
def api_apps2_wordpress(body: WPInstallBody, user: str = auth.CurrentUser):
    return {"job": _app_call(apps.install_wordpress, body.options).id}


@app.post("/api/apps2/remove")
def api_apps2_remove(body: AppRemoveBody, user: str = auth.CurrentUser):
    return _app_call(apps.uninstall, body.path, body.drop_db, body.remove_site)


@app.get("/api/apps2/password")
def api_apps2_password(user: str = auth.CurrentUser):
    return apps.suggest_password()


@app.get("/api/system/processes")
def api_processes(sort_by: str = "cpu", limit: int = 40, user: str = auth.CurrentUser):
    return {"processes": system_info.processes(limit=limit, sort_by=sort_by)}


@app.post("/api/system/processes/{pid}/kill")
def api_kill(pid: int, user: str = auth.CurrentUser):
    import psutil
    try:
        system_info.kill_process(pid)
    except psutil.NoSuchProcess:
        raise HTTPException(status_code=404, detail="No such process")
    except psutil.AccessDenied:
        raise HTTPException(status_code=403, detail="Access denied (try running as root)")
    return {"ok": True, "pid": pid}


# --------------------------------------------------------------------------- #
# Services
# --------------------------------------------------------------------------- #
@app.get("/api/services")
def api_services(user: str = auth.CurrentUser):
    try:
        return {"services": services.list_services(), "supported": services.IS_LINUX}
    except services.ServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/services/control")
def api_service_control(body: ServiceBody, user: str = auth.CurrentUser):
    try:
        return services.control_service(body.unit, body.action)
    except services.ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/services/status")
def api_service_status(unit: str, user: str = auth.CurrentUser):
    try:
        return services.service_status(unit)
    except services.ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------------------------- #
# File manager
# --------------------------------------------------------------------------- #
@app.get("/api/files/list")
def api_files_list(path: str = "", user: str = auth.CurrentUser):
    try:
        return files.list_dir(path)
    except files.FileError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/files/read")
def api_files_read(path: str, user: str = auth.CurrentUser):
    try:
        return files.read_text(path)
    except files.FileError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/files/write")
def api_files_write(body: WriteBody, user: str = auth.CurrentUser):
    try:
        return files.write_text(body.path, body.content)
    except files.FileError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class DeleteBody(BaseModel):
    path: str
    permanent: bool = False


class ZipBody(BaseModel):
    path: str = ""
    names: list[str]
    archive_name: str = "archive.zip"
    overwrite: bool = False


class UnzipBody(BaseModel):
    path: str
    overwrite: bool = False


class TrashActionBody(BaseModel):
    id: str
    overwrite: bool = False


@app.post("/api/files/delete")
def api_files_delete(body: DeleteBody, user: str = auth.CurrentUser):
    try:
        return files.delete(body.path, body.permanent)
    except files.FileError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/files/zip")
def api_files_zip(body: ZipBody, user: str = auth.CurrentUser):
    try:
        return files.zip_entries(body.path, body.names, body.archive_name, body.overwrite)
    except files.FileError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/files/unzip")
def api_files_unzip(body: UnzipBody, user: str = auth.CurrentUser):
    try:
        return files.unzip(body.path, body.overwrite)
    except files.FileError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/files/trash")
def api_files_trash(user: str = auth.CurrentUser):
    return files.list_trash()


@app.post("/api/files/trash/restore")
def api_files_trash_restore(body: TrashActionBody, user: str = auth.CurrentUser):
    try:
        return files.restore_trash(body.id, body.overwrite)
    except files.FileError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/files/trash/delete")
def api_files_trash_delete(body: TrashActionBody, user: str = auth.CurrentUser):
    try:
        return files.delete_trash(body.id)
    except files.FileError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/files/trash/empty")
def api_files_trash_empty(user: str = auth.CurrentUser):
    return files.empty_trash()


@app.post("/api/files/mkdir")
def api_files_mkdir(body: MkdirBody, user: str = auth.CurrentUser):
    try:
        return files.make_dir(body.path, body.name)
    except files.FileError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except (FileExistsError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/files/upload")
async def api_files_upload(
    path: str = Form(""), file: UploadFile = File(...), user: str = auth.CurrentUser
):
    data = await file.read()
    try:
        return files.save_upload(path, file.filename or "upload.bin", data)
    except files.FileError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/files/download")
def api_files_download(path: str, user: str = auth.CurrentUser):
    try:
        target = files.resolve_for_download(path)
    except files.FileError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return FileResponse(target, filename=target.name)


# --------------------------------------------------------------------------- #
# Background jobs (shared by packages + backups)
# --------------------------------------------------------------------------- #
@app.get("/api/jobs")
def api_jobs(user: str = auth.CurrentUser):
    return {"jobs": jobs.listing()}


@app.get("/api/jobs/{job_id}")
def api_job(job_id: str, tail: int = 400, user: str = auth.CurrentUser):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="No such job")
    return job.to_dict(tail=tail)


# --------------------------------------------------------------------------- #
# Packages (apt)
# --------------------------------------------------------------------------- #
class PkgNamesBody(BaseModel):
    packages: list[str]


@app.get("/api/packages/installed")
def api_pkg_installed(user: str = auth.CurrentUser):
    return {"packages": packages.installed(), "supported": packages.IS_LINUX}


@app.get("/api/packages/upgradable")
def api_pkg_upgradable(user: str = auth.CurrentUser):
    try:
        return {"packages": packages.upgradable()}
    except packages.PackageError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/packages/search")
def api_pkg_search(q: str, user: str = auth.CurrentUser):
    try:
        return {"results": packages.search(q)}
    except packages.PackageError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/packages/update")
def api_pkg_update(user: str = auth.CurrentUser):
    try:
        return {"job": packages.job_update().id}
    except packages.PackageError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/packages/upgrade")
def api_pkg_upgrade(user: str = auth.CurrentUser):
    try:
        return {"job": packages.job_upgrade().id}
    except packages.PackageError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/packages/install")
def api_pkg_install(body: PkgNamesBody, user: str = auth.CurrentUser):
    try:
        return {"job": packages.job_install(body.packages).id}
    except packages.PackageError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/packages/remove")
def api_pkg_remove(body: PkgNamesBody, user: str = auth.CurrentUser):
    try:
        return {"job": packages.job_remove(body.packages).id}
    except packages.PackageError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------------------------- #
# Cron
# --------------------------------------------------------------------------- #
class CronAddBody(BaseModel):
    schedule: str
    command: str
    label: str | None = None


class CronDelBody(BaseModel):
    raw: str


class CronUpdateBody(BaseModel):
    raw: str
    schedule: str
    command: str
    label: str | None = None
    paused: bool = False


class CronPauseBody(BaseModel):
    raw: str
    paused: bool


@app.get("/api/cron")
def api_cron(user: str = auth.CurrentUser):
    try:
        return {**cron.list_jobs(), "supported": cron.IS_LINUX}
    except cron.CronError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/cron/add")
def api_cron_add(body: CronAddBody, user: str = auth.CurrentUser):
    try:
        return cron.add_job(body.schedule, body.command, body.label)
    except cron.CronError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/cron/update")
def api_cron_update(body: CronUpdateBody, user: str = auth.CurrentUser):
    try:
        return cron.update_job(body.raw, body.schedule, body.command, body.label, body.paused)
    except cron.CronError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/cron/pause")
def api_cron_pause(body: CronPauseBody, user: str = auth.CurrentUser):
    try:
        return cron.set_paused(body.raw, body.paused)
    except cron.CronError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/cron/run")
def api_cron_run(body: CronDelBody, user: str = auth.CurrentUser):
    try:
        return cron.run_now(body.raw)
    except cron.CronError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/cron/delete")
def api_cron_delete(body: CronDelBody, user: str = auth.CurrentUser):
    try:
        return cron.delete_job(body.raw)
    except cron.CronError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------------------------- #
# Users
# --------------------------------------------------------------------------- #
class UserAddBody(BaseModel):
    name: str
    create_home: bool = True
    shell: str = "/bin/bash"


class UserDelBody(BaseModel):
    name: str
    remove_home: bool = False


class UserLockBody(BaseModel):
    name: str
    locked: bool


class UserPwBody(BaseModel):
    name: str
    password: str


@app.get("/api/users")
def api_users(include_system: bool = False, user: str = auth.CurrentUser):
    return {"users": users.list_users(include_system=include_system), "supported": users.IS_LINUX}


@app.post("/api/users/add")
def api_users_add(body: UserAddBody, user: str = auth.CurrentUser):
    try:
        return users.add_user(body.name, body.create_home, body.shell)
    except users.UserError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/users/delete")
def api_users_delete(body: UserDelBody, user: str = auth.CurrentUser):
    try:
        return users.delete_user(body.name, body.remove_home)
    except users.UserError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/users/lock")
def api_users_lock(body: UserLockBody, user: str = auth.CurrentUser):
    try:
        return users.set_lock(body.name, body.locked)
    except users.UserError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/users/password")
def api_users_password(body: UserPwBody, user: str = auth.CurrentUser):
    try:
        return users.set_password(body.name, body.password)
    except users.UserError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------------------------- #
# Firewall (ufw)
# --------------------------------------------------------------------------- #
class FwToggleBody(BaseModel):
    enabled: bool


class FwRuleBody(BaseModel):
    action: str
    port: str
    proto: str = "tcp"


class FwDelBody(BaseModel):
    num: int


@app.get("/api/firewall")
def api_firewall(user: str = auth.CurrentUser):
    return firewall.status()


@app.post("/api/firewall/toggle")
def api_firewall_toggle(body: FwToggleBody, user: str = auth.CurrentUser):
    try:
        return firewall.set_enabled(body.enabled)
    except firewall.FirewallError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/firewall/rule")
def api_firewall_rule(body: FwRuleBody, user: str = auth.CurrentUser):
    try:
        return firewall.add_rule(body.action, body.port, body.proto)
    except firewall.FirewallError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/firewall/delete")
def api_firewall_delete(body: FwDelBody, user: str = auth.CurrentUser):
    try:
        return firewall.delete_rule(body.num)
    except firewall.FirewallError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------------------------- #
# Disk usage
# --------------------------------------------------------------------------- #
@app.get("/api/diskusage")
def api_diskusage(path: str = "/", user: str = auth.CurrentUser):
    try:
        return diskusage.children_sizes(path)
    except diskusage.DiskUsageError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------------------------- #
# Backups
# --------------------------------------------------------------------------- #
class BackupCreateBody(BaseModel):
    source: str
    label: str = ""


class BackupRestoreBody(BaseModel):
    name: str
    dest: str = "/"


class BackupNameBody(BaseModel):
    name: str


@app.get("/api/backups")
def api_backups(user: str = auth.CurrentUser):
    return backups.list_backups()


@app.post("/api/backups/create")
def api_backups_create(body: BackupCreateBody, user: str = auth.CurrentUser):
    try:
        return {"job": backups.create_backup(body.source, body.label).id}
    except backups.BackupError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/backups/restore")
def api_backups_restore(body: BackupRestoreBody, user: str = auth.CurrentUser):
    try:
        return {"job": backups.restore_backup(body.name, body.dest).id}
    except backups.BackupError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/backups/delete")
def api_backups_delete(body: BackupNameBody, user: str = auth.CurrentUser):
    try:
        return backups.delete_backup(body.name)
    except backups.BackupError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/backups/download")
def api_backups_download(name: str, user: str = auth.CurrentUser):
    try:
        target = backups.resolve_for_download(name)
    except backups.BackupError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return FileResponse(target, filename=target.name)


# --------------------------------------------------------------------------- #
# Two-factor auth
# --------------------------------------------------------------------------- #
class OtpBody(BaseModel):
    code: str


@app.get("/api/2fa/status")
def api_2fa_status(user: str = auth.CurrentUser):
    return twofa.status()


@app.post("/api/2fa/enroll")
def api_2fa_enroll(user: str = auth.CurrentUser):
    return twofa.begin_enroll(user)


@app.post("/api/2fa/enable")
def api_2fa_enable(body: OtpBody, request: Request, user: str = auth.CurrentUser):
    if not twofa.confirm_enable(body.code):
        raise HTTPException(status_code=400, detail="Invalid or expired code")
    # Sessions opened without 2FA shouldn't outlive turning it on: sign them
    # all out and give this browser a fresh cookie.
    config.rotate_session_secret()
    resp = JSONResponse({"ok": True, "enabled": True})
    _set_session(resp, request, config.get_prefs()["username"])
    return resp


@app.post("/api/2fa/disable")
def api_2fa_disable(body: OtpBody, user: str = auth.CurrentUser):
    if not twofa.disable(body.code):
        raise HTTPException(status_code=400, detail="Invalid code")
    return {"ok": True, "enabled": False}


# --------------------------------------------------------------------------- #
# Advanced: Apache .htaccess (Indexes, MIME, Error pages, Handlers)
# --------------------------------------------------------------------------- #
class IndexesBody(BaseModel):
    dir: str = ""
    listing: bool
    directory_index: str | None = None


class MimeAddBody(BaseModel):
    dir: str = ""
    mime: str
    extensions: str


class ErrorSetBody(BaseModel):
    dir: str = ""
    code: str
    document: str


class HandlerAddBody(BaseModel):
    dir: str = ""
    handler: str
    extensions: str


class ApacheRemoveBody(BaseModel):
    dir: str = ""
    raw: str


@app.get("/api/apache/htaccess")
def api_apache_raw(dir: str = "", user: str = auth.CurrentUser):
    try:
        return apache.raw(dir)
    except apache.ApacheError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/apache/indexes")
def api_apache_indexes(dir: str = "", user: str = auth.CurrentUser):
    try:
        return {**apache.get_indexes(dir), "root": str(apache.APACHE_ROOT)}
    except apache.ApacheError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/apache/indexes")
def api_apache_set_indexes(body: IndexesBody, user: str = auth.CurrentUser):
    try:
        return apache.set_indexes(body.dir, body.listing, body.directory_index)
    except apache.ApacheError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/apache/mime")
def api_apache_mime(dir: str = "", user: str = auth.CurrentUser):
    try:
        return {**apache.list_mime(dir), "system": apache.system_mime()}
    except apache.ApacheError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/apache/mime")
def api_apache_add_mime(body: MimeAddBody, user: str = auth.CurrentUser):
    try:
        return apache.add_mime(body.dir, body.mime, body.extensions)
    except apache.ApacheError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/apache/errors")
def api_apache_errors(dir: str = "", user: str = auth.CurrentUser):
    try:
        return apache.list_errors(dir)
    except apache.ApacheError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/apache/errors")
def api_apache_set_error(body: ErrorSetBody, user: str = auth.CurrentUser):
    try:
        return apache.set_error(body.dir, body.code, body.document)
    except apache.ApacheError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/apache/handlers")
def api_apache_handlers(dir: str = "", user: str = auth.CurrentUser):
    try:
        return apache.list_handlers(dir)
    except apache.ApacheError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/apache/handlers")
def api_apache_add_handler(body: HandlerAddBody, user: str = auth.CurrentUser):
    try:
        return apache.add_handler(body.dir, body.handler, body.extensions)
    except apache.ApacheError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/apache/remove")
def api_apache_remove(body: ApacheRemoveBody, user: str = auth.CurrentUser):
    try:
        return apache.remove_directive(body.dir, body.raw)
    except apache.ApacheError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------------------------- #
# Advanced: Track DNS
# --------------------------------------------------------------------------- #
@app.get("/api/dns/records")
def api_dns_records(host: str, user: str = auth.CurrentUser):
    try:
        return netdiag.dns_records(host)
    except netdiag.NetDiagError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/dns/reverse")
def api_dns_reverse(ip: str, user: str = auth.CurrentUser):
    try:
        return netdiag.reverse_lookup(ip)
    except netdiag.NetDiagError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/dns/traceroute")
def api_dns_traceroute(host: str, user: str = auth.CurrentUser):
    try:
        return netdiag.traceroute(host)
    except netdiag.NetDiagError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/net/ping")
def api_net_ping(host: str, count: int = 4, user: str = auth.CurrentUser):
    try:
        return netdiag.ping(host, count)
    except netdiag.NetDiagError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------------------------- #
# Advanced: Virus scanner (ClamAV)
# --------------------------------------------------------------------------- #
class ScanBody(BaseModel):
    path: str
    recursive: bool = True


@app.get("/api/antivirus/status")
def api_av_status(user: str = auth.CurrentUser):
    return antivirus.status()


@app.post("/api/antivirus/scan")
def api_av_scan(body: ScanBody, user: str = auth.CurrentUser):
    try:
        return {"job": antivirus.scan(body.path, body.recursive).id}
    except antivirus.AntivirusError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/antivirus/update")
def api_av_update(user: str = auth.CurrentUser):
    try:
        return {"job": antivirus.update_db().id}
    except antivirus.AntivirusError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------------------------- #
# Security: SSH Access
# --------------------------------------------------------------------------- #
class SSHKeyBody(BaseModel):
    user: str
    public_key: str


class SSHKeyRemoveBody(BaseModel):
    user: str
    raw: str


@app.get("/api/ssh/status")
def api_ssh_status(user: str = auth.CurrentUser):
    return sshaccess.status()


@app.post("/api/ssh/restart")
def api_ssh_restart(user: str = auth.CurrentUser):
    try:
        return sshaccess.restart()
    except sshaccess.SSHError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/ssh/keys")
def api_ssh_keys(target: str, user: str = auth.CurrentUser):
    try:
        return sshaccess.list_keys(target)
    except sshaccess.SSHError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/ssh/keys/add")
def api_ssh_keys_add(body: SSHKeyBody, user: str = auth.CurrentUser):
    try:
        return sshaccess.add_key(body.user, body.public_key)
    except sshaccess.SSHError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/ssh/keys/remove")
def api_ssh_keys_remove(body: SSHKeyRemoveBody, user: str = auth.CurrentUser):
    try:
        return sshaccess.remove_key(body.user, body.raw)
    except sshaccess.SSHError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------------------------- #
# Security: IP Blocker
# --------------------------------------------------------------------------- #
class IPBody(BaseModel):
    ip: str


class NumBody(BaseModel):
    num: int


@app.get("/api/ipblocker")
def api_ipblocker(user: str = auth.CurrentUser):
    return ipblocker.list_blocked()


@app.post("/api/ipblocker/block")
def api_ipblocker_block(body: IPBody, request: Request, user: str = auth.CurrentUser):
    try:
        return ipblocker.block(body.ip, request.client.host if request.client else None)
    except ipblocker.IPBlockError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/ipblocker/unblock")
def api_ipblocker_unblock(body: NumBody, user: str = auth.CurrentUser):
    try:
        return ipblocker.unblock(body.num)
    except (ipblocker.IPBlockError, firewall.FirewallError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------------------------- #
# Security: SSL/TLS Certificates
# --------------------------------------------------------------------------- #
class SelfSignedBody(BaseModel):
    common_name: str
    days: int = 365


@app.get("/api/ssl/certs")
def api_ssl_certs(user: str = auth.CurrentUser):
    try:
        return sslcerts.list_certs()
    except sslcerts.SSLCertError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/ssl/selfsigned")
def api_ssl_selfsigned(body: SelfSignedBody, user: str = auth.CurrentUser):
    try:
        return sslcerts.generate_self_signed(body.common_name, body.days)
    except sslcerts.SSLCertError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------------------------- #
# Security: API Tokens
# --------------------------------------------------------------------------- #
class TokenNameBody(BaseModel):
    name: str


class TokenIdBody(BaseModel):
    id: str


@app.get("/api/tokens")
def api_tokens(user: str = auth.CurrentUser):
    return apitokens.listing()


@app.post("/api/tokens/create")
def api_tokens_create(body: TokenNameBody, user: str = auth.CurrentUser):
    try:
        return apitokens.create(body.name)
    except apitokens.APITokenError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/tokens/revoke")
def api_tokens_revoke(body: TokenIdBody, user: str = auth.CurrentUser):
    try:
        return apitokens.revoke(body.id)
    except apitokens.APITokenError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------------------------- #
# Security: Hotlink Protection + Redirects (Apache)
# --------------------------------------------------------------------------- #
class HotlinkBody(BaseModel):
    dir: str = ""
    enabled: bool
    allowed_hosts: str = ""
    extensions: str = ""


class RedirectBody(BaseModel):
    dir: str = ""
    code: str
    source: str
    target: str


@app.get("/api/apache/hotlink")
def api_hotlink(dir: str = "", user: str = auth.CurrentUser):
    try:
        return {**apache.get_hotlink(dir), "root": str(apache.APACHE_ROOT)}
    except apache.ApacheError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/apache/hotlink")
def api_hotlink_set(body: HotlinkBody, user: str = auth.CurrentUser):
    try:
        return apache.set_hotlink(body.dir, body.enabled, body.allowed_hosts, body.extensions)
    except apache.ApacheError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/apache/redirects")
def api_redirects(dir: str = "", user: str = auth.CurrentUser):
    try:
        return apache.list_redirects(dir)
    except apache.ApacheError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/apache/redirects")
def api_redirects_add(body: RedirectBody, user: str = auth.CurrentUser):
    try:
        return apache.add_redirect(body.dir, body.code, body.source, body.target)
    except apache.ApacheError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------------------------- #
# Security: ModSecurity
# --------------------------------------------------------------------------- #
class EnableBody(BaseModel):
    enabled: bool


@app.get("/api/modsecurity")
def api_modsec(user: str = auth.CurrentUser):
    return modsecurity.status()


@app.post("/api/modsecurity/toggle")
def api_modsec_toggle(body: EnableBody, user: str = auth.CurrentUser):
    try:
        return modsecurity.set_enabled(body.enabled)
    except modsecurity.ModSecError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/modsecurity/install")
def api_modsec_install(user: str = auth.CurrentUser):
    return {"job": modsecurity.install().id}


# --------------------------------------------------------------------------- #
# Security: Leech Protection (fail2ban)
# --------------------------------------------------------------------------- #
class UnbanBody(BaseModel):
    jail: str
    ip: str


@app.get("/api/fail2ban")
def api_fail2ban(user: str = auth.CurrentUser):
    return fail2ban.status()


@app.post("/api/fail2ban/unban")
def api_fail2ban_unban(body: UnbanBody, user: str = auth.CurrentUser):
    try:
        return fail2ban.unban(body.jail, body.ip)
    except fail2ban.Fail2banError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/fail2ban/install")
def api_fail2ban_install(user: str = auth.CurrentUser):
    return {"job": fail2ban.install().id}


# --------------------------------------------------------------------------- #
# Security: Fix Home Permissions
# --------------------------------------------------------------------------- #
class NameBody(BaseModel):
    name: str


@app.post("/api/fixperms")
def api_fixperms(body: NameBody, user: str = auth.CurrentUser):
    try:
        return perms.fix_home(body.name)
    except perms.PermError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------------------------- #
# Domains
# --------------------------------------------------------------------------- #
class VhostBody(BaseModel):
    server_name: str
    docroot: str = ""
    port: int = 80


class DomainNameBody(BaseModel):
    server_name: str


class SiteSaveBody(BaseModel):
    original: str = ""
    settings: dict


class SiteToggleBody(BaseModel):
    server_name: str
    key: str
    value: bool


class LEBody(BaseModel):
    server_name: str
    email: str
    include_aliases: bool = True


def _site_call(fn, *a):
    try:
        return fn(*a)
    except sites.SiteError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/sites")
def api_sites(user: str = auth.CurrentUser):
    return sites.list_sites()


@app.get("/api/sites/get")
def api_site_get(name: str, user: str = auth.CurrentUser):
    return _site_call(sites.get_site, name)


@app.post("/api/sites/create")
def api_site_create(body: SiteSaveBody, user: str = auth.CurrentUser):
    return _site_call(sites.create_site, body.settings)


@app.post("/api/sites/save")
def api_site_save(body: SiteSaveBody, user: str = auth.CurrentUser):
    return _site_call(sites.save_site, body.original, body.settings)


@app.post("/api/sites/toggle")
def api_site_toggle(body: SiteToggleBody, user: str = auth.CurrentUser):
    return _site_call(sites.quick_toggle, body.server_name, body.key, body.value)


@app.post("/api/sites/remove")
def api_site_remove(body: DomainNameBody, user: str = auth.CurrentUser):
    return _site_call(sites.remove_site, body.server_name)


@app.post("/api/sites/certbot/install")
def api_certbot_install(user: str = auth.CurrentUser):
    return {"job": sites.certbot_install().id}


@app.post("/api/sites/letsencrypt")
def api_site_le(body: LEBody, user: str = auth.CurrentUser):
    return {"job": _site_call(sites.issue_letsencrypt, body.server_name, body.email, body.include_aliases).id}


# ---- Zone Editor (structured) ----
class ZoneCreateBody(BaseModel):
    domain: str
    ip: str = ""
    mode: str = "default"


class ZoneRecordBody(BaseModel):
    domain: str
    record: dict = {}
    index: int = -1
    fingerprint: dict | None = None


class ZoneDomainBody(BaseModel):
    domain: str


def _zone_call(fn, *a):
    try:
        return fn(*a)
    except dnszones.ZoneError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/dns/zones")
def api_dns_zones(user: str = auth.CurrentUser):
    names = []
    try:
        for s in sites.list_sites().get("sites", []):
            names += [s["server_name"], *s["aliases"]]
    except Exception:
        pass
    return dnszones.list_zones(names)


@app.get("/api/dns/zone")
def api_dns_zone(domain: str, user: str = auth.CurrentUser):
    return _zone_call(dnszones.get_zone, domain)


@app.post("/api/dns/zone/create")
def api_dns_zone_create(body: ZoneCreateBody, user: str = auth.CurrentUser):
    return _zone_call(dnszones.create_zone, body.domain, body.ip, body.mode)


@app.post("/api/dns/zone/delete")
def api_dns_zone_delete(body: ZoneDomainBody, user: str = auth.CurrentUser):
    return _zone_call(dnszones.delete_zone, body.domain)


@app.post("/api/dns/record/add")
def api_dns_record_add(body: ZoneRecordBody, user: str = auth.CurrentUser):
    return _zone_call(dnszones.add_record, body.domain, body.record)


@app.post("/api/dns/record/update")
def api_dns_record_update(body: ZoneRecordBody, user: str = auth.CurrentUser):
    return _zone_call(dnszones.update_record, body.domain, body.index, body.record, body.fingerprint)


@app.post("/api/dns/record/delete")
def api_dns_record_delete(body: ZoneRecordBody, user: str = auth.CurrentUser):
    return _zone_call(dnszones.delete_record, body.domain, body.index, body.fingerprint)


@app.get("/api/domains/vhosts")
def api_vhosts(user: str = auth.CurrentUser):
    try:
        return domains.list_vhosts()
    except domains.DomainError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/domains/vhosts/create")
def api_vhost_create(body: VhostBody, user: str = auth.CurrentUser):
    try:
        return domains.create_vhost(body.server_name, body.docroot, body.port)
    except domains.DomainError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/domains/vhosts/remove")
def api_vhost_remove(body: DomainNameBody, user: str = auth.CurrentUser):
    try:
        return domains.remove_vhost(body.server_name)
    except domains.DomainError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/domains/info")
def api_domain_info(name: str, user: str = auth.CurrentUser):
    try:
        return domains.domain_info(name)
    except domains.DomainError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/domains/dyndns")
def api_dyndns(user: str = auth.CurrentUser):
    return domains.dyndns_status()


@app.post("/api/domains/dyndns/run")
def api_dyndns_run(user: str = auth.CurrentUser):
    try:
        return domains.dyndns_run()
    except domains.DomainError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/domains/dyndns/install")
def api_dyndns_install(user: str = auth.CurrentUser):
    return {"job": domains.dyndns_install().id}


@app.get("/api/domains/zones")
def api_zones(user: str = auth.CurrentUser):
    return domains.zones()


@app.get("/api/domains/zone")
def api_zone(name: str, user: str = auth.CurrentUser):
    try:
        return domains.zone_content(name)
    except domains.DomainError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/domains/bind/install")
def api_bind_install(user: str = auth.CurrentUser):
    return {"job": domains.bind_install().id}


# --------------------------------------------------------------------------- #
# Databases
# --------------------------------------------------------------------------- #
class DBNameBody(BaseModel):
    name: str


class DBUserBody(BaseModel):
    user: str
    host: str = "localhost"
    password: str


class DBWizardBody(BaseModel):
    db: str
    user: str
    password: str
    host: str = "localhost"


class PGWizardBody(BaseModel):
    db: str
    role: str
    password: str


class PkgBody(BaseModel):
    pkg: str


@app.get("/api/db/overview")
def api_db_overview(user: str = auth.CurrentUser):
    return databases.overview()


@app.get("/api/db/mysql")
def api_db_mysql(user: str = auth.CurrentUser):
    st = databases.mysql_status()
    if not (st["installed"] and st["running"]):
        return {**st, "databases": [], "users": [], "phpmyadmin": databases.phpmyadmin_status()}
    try:
        return {**st, **databases.mysql_overview(), "phpmyadmin": databases.phpmyadmin_status()}
    except databases.DatabaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/db/mysql/create")
def api_db_mysql_create(body: DBNameBody, user: str = auth.CurrentUser):
    try:
        return databases.mysql_create_db(body.name)
    except databases.DatabaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/db/mysql/drop")
def api_db_mysql_drop(body: DBNameBody, user: str = auth.CurrentUser):
    try:
        return databases.mysql_drop_db(body.name)
    except databases.DatabaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/db/mysql/wizard")
def api_db_mysql_wizard(body: DBWizardBody, user: str = auth.CurrentUser):
    try:
        return databases.mysql_wizard(body.db, body.user, body.password, body.host)
    except databases.DatabaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _db_call(fn):
    try:
        return fn()
    except databases.DatabaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class MyUserBody(BaseModel):
    user: str
    host: str = "localhost"
    password: str = ""
    db: str = ""
    admin: bool = False


class MyGrantBody(BaseModel):
    db: str
    user: str
    host: str = "localhost"
    on: bool = True


@app.post("/api/db/mysql/user/create")
def api_db_mysql_user_create(body: MyUserBody, user: str = auth.CurrentUser):
    return _db_call(lambda: databases.mysql_create_user(body.user, body.host, body.password, body.db, body.admin))


@app.post("/api/db/mysql/user/password")
def api_db_mysql_user_password(body: MyUserBody, user: str = auth.CurrentUser):
    return _db_call(lambda: databases.mysql_set_password(body.user, body.host, body.password))


@app.post("/api/db/mysql/user/admin")
def api_db_mysql_user_admin(body: MyUserBody, user: str = auth.CurrentUser):
    return _db_call(lambda: databases.mysql_set_admin(body.user, body.host, body.admin))


@app.post("/api/db/mysql/user/drop")
def api_db_mysql_user_drop(body: MyUserBody, user: str = auth.CurrentUser):
    return _db_call(lambda: databases.mysql_drop_user(body.user, body.host))


@app.post("/api/db/mysql/grant")
def api_db_mysql_grant(body: MyGrantBody, user: str = auth.CurrentUser):
    return _db_call(lambda: databases.mysql_grant(body.db, body.user, body.host, body.on))


@app.post("/api/db/phpmyadmin/install")
def api_db_phpmyadmin_install(user: str = auth.CurrentUser):
    return _db_call(lambda: {"job": databases.phpmyadmin_install().id})


class PGCreateBody(BaseModel):
    name: str
    owner: str = ""


class PGRoleBody(BaseModel):
    name: str
    password: str = ""
    login: bool = True
    createdb: bool = False
    createrole: bool = False
    superuser: bool = False
    conn_limit: int = -1


class PGGrantBody(BaseModel):
    db: str
    role: str
    grant: bool = True


class PGOwnerBody(BaseModel):
    db: str
    role: str


class OnBody(BaseModel):
    on: bool


@app.get("/api/db/pg")
def api_db_pg(user: str = auth.CurrentUser):
    st = databases.pg_status()
    pga = databases.phppgadmin_status()
    if not (st["installed"] and st["running"]):
        return {**st, "databases": [], "roles": [], "phppgadmin": pga}
    return _db_call(lambda: {**st, **databases.pg_overview(), "phppgadmin": pga})


@app.post("/api/db/pg/role/create")
def api_db_pg_role_create(body: PGRoleBody, user: str = auth.CurrentUser):
    return _db_call(lambda: databases.pg_create_role(body.name, body.password, body.login, body.createdb,
                                                      body.createrole, body.superuser))


@app.post("/api/db/pg/role/update")
def api_db_pg_role_update(body: PGRoleBody, user: str = auth.CurrentUser):
    return _db_call(lambda: databases.pg_update_role(body.name, body.login, body.createdb, body.createrole,
                                                      body.superuser, body.conn_limit))


@app.post("/api/db/pg/role/password")
def api_db_pg_role_password(body: PGRoleBody, user: str = auth.CurrentUser):
    return _db_call(lambda: databases.pg_set_password(body.name, body.password))


@app.post("/api/db/pg/role/drop")
def api_db_pg_role_drop(body: DBNameBody, user: str = auth.CurrentUser):
    return _db_call(lambda: databases.pg_drop_role(body.name))


@app.post("/api/db/pg/grant")
def api_db_pg_grant(body: PGGrantBody, user: str = auth.CurrentUser):
    return _db_call(lambda: databases.pg_grant(body.db, body.role, body.grant))


@app.post("/api/db/pg/owner")
def api_db_pg_owner(body: PGOwnerBody, user: str = auth.CurrentUser):
    return _db_call(lambda: databases.pg_set_owner(body.db, body.role))


@app.post("/api/db/phppgadmin/lan")
def api_db_phppgadmin_lan(body: OnBody, user: str = auth.CurrentUser):
    return _db_call(lambda: databases.phppgadmin_set_lan(body.on))


@app.post("/api/db/phppgadmin/install")
def api_db_phppgadmin_install(user: str = auth.CurrentUser):
    return _db_call(lambda: {"job": databases.phppgadmin_install().id})


@app.post("/api/db/pg/repair")
def api_db_pg_repair(user: str = auth.CurrentUser):
    try:
        return databases.pg_repair()
    except databases.DatabaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/db/pg/create")
def api_db_pg_create(body: PGCreateBody, user: str = auth.CurrentUser):
    return _db_call(lambda: databases.pg_create_db_owned(body.name, body.owner))


@app.post("/api/db/pg/drop")
def api_db_pg_drop(body: DBNameBody, user: str = auth.CurrentUser):
    return _db_call(lambda: databases.pg_drop_db_force(body.name))


@app.post("/api/db/pg/wizard")
def api_db_pg_wizard(body: PGWizardBody, user: str = auth.CurrentUser):
    try:
        return databases.pg_wizard(body.db, body.role, body.password)
    except databases.DatabaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/db/install")
def api_db_install(body: PkgBody, user: str = auth.CurrentUser):
    try:
        return {"job": databases.install_pkg(body.pkg).id}
    except databases.DatabaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------------------------- #
# Software: Application Manager
# --------------------------------------------------------------------------- #
class AppCreateBody(BaseModel):
    name: str
    workdir: str
    command: str
    autostart: bool = True


class AppActionBody(BaseModel):
    name: str
    action: str


@app.get("/api/apps")
def api_apps(user: str = auth.CurrentUser):
    return appmanager.list_apps()


@app.post("/api/apps/create")
def api_apps_create(body: AppCreateBody, user: str = auth.CurrentUser):
    try:
        return appmanager.create_app(body.name, body.workdir, body.command, body.autostart)
    except appmanager.AppError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/apps/control")
def api_apps_control(body: AppActionBody, user: str = auth.CurrentUser):
    try:
        return appmanager.control_app(body.name, body.action)
    except appmanager.AppError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/apps/remove")
def api_apps_remove(body: NameBody, user: str = auth.CurrentUser):
    try:
        return appmanager.remove_app(body.name)
    except appmanager.AppError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/apps/logs")
def api_apps_logs(name: str, user: str = auth.CurrentUser):
    try:
        return appmanager.logs(name)
    except appmanager.AppError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------------------------- #
# Software: Select PHP Version
# --------------------------------------------------------------------------- #
class PHPBody(BaseModel):
    version: str


@app.get("/api/php")
def api_php(user: str = auth.CurrentUser):
    return phpmgr.status()


@app.post("/api/php/set")
def api_php_set(body: PHPBody, user: str = auth.CurrentUser):
    try:
        return phpmgr.set_cli_version(body.version)
    except phpmgr.PHPError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _php_call(fn):
    try:
        return fn()
    except (phpsettings.PHPSettingsError, phpmgr.PHPError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class PHPSettingsBody(BaseModel):
    version: str
    sapis: list[str]
    changes: dict = {}
    reset: list[str] = []


class PHPExtBody(BaseModel):
    version: str
    module: str
    sapi: str | None = None
    on: bool = True


@app.get("/api/php/settings/overview")
def api_php_overview(user: str = auth.CurrentUser):
    return _php_call(phpsettings.overview)


@app.get("/api/php/settings")
def api_php_settings(version: str, sapi: str, user: str = auth.CurrentUser):
    return _php_call(lambda: phpsettings.get(version, sapi))


@app.post("/api/php/settings")
def api_php_settings_save(body: PHPSettingsBody, user: str = auth.CurrentUser):
    return _php_call(lambda: phpsettings.save(body.version, body.sapis, body.changes, body.reset))


@app.get("/api/php/extensions")
def api_php_extensions(version: str, user: str = auth.CurrentUser):
    return _php_call(lambda: phpsettings.extensions(version))


@app.post("/api/php/extensions/toggle")
def api_php_ext_toggle(body: PHPExtBody, user: str = auth.CurrentUser):
    return _php_call(lambda: phpsettings.set_extension(body.version, body.module, body.sapi or "", body.on))


@app.post("/api/php/extensions/install")
def api_php_ext_install(body: PHPExtBody, user: str = auth.CurrentUser):
    return _php_call(lambda: {"job": phpsettings.install_extension(body.version, body.module).id})


@app.post("/api/php/apache-version")
def api_php_apache_version(body: PHPBody, user: str = auth.CurrentUser):
    return _php_call(lambda: phpsettings.set_apache_version(body.version))


# --------------------------------------------------------------------------- #
# Software: System Applications (web servers, PHP-FPM, MariaDB, FTP)
# --------------------------------------------------------------------------- #
class SysAppBody(BaseModel):
    id: str
    action: str | None = None
    switch: bool = False


def _sysapp_call(fn):
    try:
        return fn()
    except sysapps.ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except sysapps.SysAppError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/sysapps")
def api_sysapps(user: str = auth.CurrentUser):
    return sysapps.status()


@app.post("/api/sysapps/install")
def api_sysapps_install(body: SysAppBody, user: str = auth.CurrentUser):
    return _sysapp_call(lambda: {"job": sysapps.install(body.id, body.switch).id})


@app.post("/api/sysapps/uninstall")
def api_sysapps_uninstall(body: SysAppBody, user: str = auth.CurrentUser):
    return _sysapp_call(lambda: {"job": sysapps.uninstall(body.id).id})


@app.post("/api/sysapps/control")
def api_sysapps_control(body: SysAppBody, user: str = auth.CurrentUser):
    return _sysapp_call(lambda: sysapps.control(body.id, body.action or "", body.switch))


# --------------------------------------------------------------------------- #
# Network: VPN servers, Dynamic DNS, Port Checker
# --------------------------------------------------------------------------- #
def _vpn_call(fn):
    try:
        return fn()
    except (vpncommon.VPNError, ddns.DDNSError, portcheck.PortError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class VPNSettingsBody(BaseModel):
    endpoint: str | None = None
    dns: str | None = None


class VPNSetupBody(BaseModel):
    port: int | None = None
    proto: str | None = None
    subnet: str | None = None
    redirect: bool = True


class VPNActionBody(BaseModel):
    action: str


class VPNClientBody(BaseModel):
    name: str
    tunnel: str | None = None
    password: str | None = None
    disabled: bool | None = None
    mode: str | None = None


class DDNSBody(BaseModel):
    provider: str
    fields: dict
    enabled: bool = True


class PortBody(BaseModel):
    port: int
    proto: str = "tcp"


_VPNS = {"wireguard": wireguard, "openvpn": openvpn, "ipsec": ipsec}


def _vpn(kind: str):
    if kind not in _VPNS:
        raise HTTPException(status_code=404, detail="Unknown VPN type")
    return _VPNS[kind]


@app.get("/api/vpn/overview")
def api_vpn_overview(user: str = auth.CurrentUser):
    out = {"settings": _vpn_call(vpncommon.settings)}
    for k, mod in _VPNS.items():
        try:
            out[k] = mod.status()
        except Exception as exc:  # one broken VPN must not hide the others
            out[k] = {"error": str(exc)}
    return out


@app.post("/api/vpn/settings")
def api_vpn_settings(body: VPNSettingsBody, user: str = auth.CurrentUser):
    return _vpn_call(lambda: vpncommon.save_settings(body.endpoint, body.dns))


@app.get("/api/vpn/{kind}")
def api_vpn_status(kind: str, user: str = auth.CurrentUser):
    return _vpn_call(_vpn(kind).status)


@app.post("/api/vpn/{kind}/install")
def api_vpn_install(kind: str, user: str = auth.CurrentUser):
    return _vpn_call(lambda: {"job": _vpn(kind).install().id})


@app.post("/api/vpn/{kind}/setup")
def api_vpn_setup(kind: str, body: VPNSetupBody, user: str = auth.CurrentUser):
    def go():
        if kind == "wireguard":
            return wireguard.setup(body.port or 51820, body.subnet or "10.8.0.0/24")
        if kind == "openvpn":
            return {"job": openvpn.setup(body.port or 1194, body.proto or "udp", body.subnet or "10.9.0.0/24",
                                         body.redirect).id}
        return {"job": ipsec.setup(body.subnet or "10.10.0.0/24").id}
    _vpn(kind)
    return _vpn_call(go)


@app.post("/api/vpn/{kind}/control")
def api_vpn_control(kind: str, body: VPNActionBody, user: str = auth.CurrentUser):
    return _vpn_call(lambda: _vpn(kind).control(body.action))


@app.post("/api/vpn/{kind}/selftest")
def api_vpn_selftest(kind: str, user: str = auth.CurrentUser):
    if kind not in ("wireguard", "openvpn"):
        raise HTTPException(status_code=400, detail="Self-test is available for WireGuard and OpenVPN")
    return _vpn_call(lambda: {"job": _vpn(kind).selftest().id})


@app.post("/api/vpn/{kind}/clients")
def api_vpn_client_add(kind: str, body: VPNClientBody, user: str = auth.CurrentUser):
    def go():
        if kind == "wireguard":
            return wireguard.add_peer(body.name, body.tunnel or "full")
        if kind == "openvpn":
            return openvpn.add_user(body.name, body.mode or "cert+password", body.password)
        return ipsec.add_user(body.name, body.password)
    _vpn(kind)
    return _vpn_call(go)


@app.post("/api/vpn/{kind}/clients/remove")
def api_vpn_client_remove(kind: str, body: VPNClientBody, user: str = auth.CurrentUser):
    fn = {"wireguard": wireguard.remove_peer, "openvpn": openvpn.revoke_client, "ipsec": ipsec.remove_user}
    _vpn(kind)
    return _vpn_call(lambda: fn[kind](body.name))


@app.post("/api/vpn/openvpn/users/password")
def api_ovpn_user_password(body: VPNClientBody, user: str = auth.CurrentUser):
    return _vpn_call(lambda: openvpn.set_password(body.name, body.password))


@app.post("/api/vpn/openvpn/users/mode")
def api_ovpn_user_mode(body: VPNClientBody, user: str = auth.CurrentUser):
    return _vpn_call(lambda: openvpn.set_mode(body.name, body.mode or "", body.password))


@app.post("/api/vpn/openvpn/users/toggle")
def api_ovpn_user_toggle(body: VPNClientBody, user: str = auth.CurrentUser):
    return _vpn_call(lambda: openvpn.set_disabled(body.name, bool(body.disabled)))


@app.post("/api/vpn/wireguard/clients/toggle")
def api_wg_client_toggle(body: VPNClientBody, user: str = auth.CurrentUser):
    return _vpn_call(lambda: wireguard.set_peer_disabled(body.name, bool(body.disabled)))


@app.get("/api/vpn/{kind}/clients/{name}/config")
def api_vpn_client_config(kind: str, name: str, user: str = auth.CurrentUser):
    fn = {"wireguard": wireguard.client_config, "openvpn": openvpn.client_config, "ipsec": ipsec.client_profiles}
    _vpn(kind)
    return _vpn_call(lambda: fn[kind](name))


@app.get("/api/ddns")
def api_ddns(user: str = auth.CurrentUser):
    return _vpn_call(ddns.status)


@app.post("/api/ddns")
def api_ddns_configure(body: DDNSBody, user: str = auth.CurrentUser):
    return _vpn_call(lambda: ddns.configure(body.provider, body.fields, body.enabled))


@app.post("/api/ddns/update")
def api_ddns_update(user: str = auth.CurrentUser):
    return _vpn_call(lambda: ddns.update(force=True))


@app.post("/api/ddns/disable")
def api_ddns_disable(user: str = auth.CurrentUser):
    return _vpn_call(ddns.disable)


@app.post("/api/ddns/stop-ddclient")
def api_ddns_stop_ddclient(user: str = auth.CurrentUser):
    return _vpn_call(ddns.stop_ddclient)


@app.post("/api/portcheck")
def api_portcheck(body: PortBody, user: str = auth.CurrentUser):
    return _vpn_call(lambda: portcheck.check(body.port, body.proto))


@app.post("/api/portcheck/upnp/open")
def api_portcheck_upnp_open(body: PortBody, user: str = auth.CurrentUser):
    return _vpn_call(lambda: portcheck.upnp_open(body.port, body.proto))


@app.post("/api/portcheck/upnp/close")
def api_portcheck_upnp_close(body: PortBody, user: str = auth.CurrentUser):
    return _vpn_call(lambda: portcheck.upnp_close(body.port, body.proto))


class NetmonLoggingBody(BaseModel):
    on: bool


@app.get("/api/netmon")
def api_netmon(hours: int = 24, scope: str = "all", user: str = auth.CurrentUser):
    if scope not in ("all", "internet", "lan", "private"):
        raise HTTPException(status_code=400, detail="Invalid scope")
    return _vpn_call(lambda: netmon.summary(hours, scope))


@app.post("/api/netmon/logging")
def api_netmon_logging(body: NetmonLoggingBody, user: str = auth.CurrentUser):
    return _vpn_call(lambda: netmon.set_logging(body.on))


@app.post("/api/portcheck/upnp/install")
def api_portcheck_upnp_install(user: str = auth.CurrentUser):
    return _vpn_call(lambda: {"job": portcheck.install_upnp().id})


# --------------------------------------------------------------------------- #
# Bans & trusted addresses (guard) + fail2ban settings
# --------------------------------------------------------------------------- #
def _guard_call(fn):
    try:
        return fn()
    except (guard.GuardError, fail2ban.Fail2banError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class GuardBody(BaseModel):
    target: str
    reason: str | None = None
    duration: int | None = None


class F2BBody(BaseModel):
    jail: str | None = None
    ip: str | None = None
    on: bool | None = None


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@app.get("/api/guard")
def api_guard(user: str = auth.CurrentUser):
    return _guard_call(guard.listing)


@app.post("/api/guard/ban")
def api_guard_ban(body: GuardBody, request: Request, user: str = auth.CurrentUser):
    return _guard_call(lambda: guard.ban(body.target, body.reason or "", body.duration, _client_ip(request)))


@app.post("/api/guard/unban")
def api_guard_unban(body: GuardBody, user: str = auth.CurrentUser):
    return _guard_call(lambda: guard.unban(body.target))


@app.post("/api/guard/trust")
def api_guard_trust(body: GuardBody, user: str = auth.CurrentUser):
    return _guard_call(lambda: guard.trust(body.target, body.reason or ""))


@app.post("/api/guard/untrust")
def api_guard_untrust(body: GuardBody, user: str = auth.CurrentUser):
    return _guard_call(lambda: guard.untrust(body.target))


@app.post("/api/fail2ban/save")
async def api_fail2ban_save(request: Request, user: str = auth.CurrentUser):
    body = await request.json()
    return _guard_call(lambda: fail2ban.save(body.get("global"), body.get("jails")))


@app.post("/api/fail2ban/service")
def api_fail2ban_service(body: F2BBody, user: str = auth.CurrentUser):
    return _guard_call(lambda: fail2ban.enable_service(bool(body.on)))


@app.post("/api/fail2ban/ban")
def api_fail2ban_ban(body: F2BBody, request: Request, user: str = auth.CurrentUser):
    return _guard_call(lambda: fail2ban.ban(body.jail or "", body.ip or "", _client_ip(request)))


@app.get("/api/fail2ban/logs")
def api_fail2ban_logs(lines: int = 200, user: str = auth.CurrentUser):
    return {"text": fail2ban.logs(max(20, min(lines, 2000)))}


# --------------------------------------------------------------------------- #
# Files section: Images, Web Disk, Directory Privacy, Git, Backup Wizard, Inodes
# --------------------------------------------------------------------------- #
def _files_call(fn):
    try:
        return fn()
    except (images.ImageError, webaccess.WebAccessError, gitvc.GitError, backups.BackupError,
            diskusage.DiskUsageError, files.FileError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class ImageOpBody(BaseModel):
    path: str
    width: int | None = None
    height: int | None = None
    percent: int | None = None
    max_px: int | None = None
    keep_aspect: bool = True
    keep_original: bool = True
    quality: int = 85
    to: str | None = None
    recursive: bool = False
    delete_original: bool = False


class WebAccessBody(BaseModel):
    name: str | None = None
    path: str | None = None
    password: str | None = None
    readonly: bool | None = None
    disabled: bool | None = None
    label: str | None = None
    remove: bool = False
    enabled: bool | None = None


class GitBody(BaseModel):
    name: str
    path: str | None = None
    owner: str | None = None
    clone_url: str | None = None
    branch: str | None = None
    use_key: bool = False
    deploy_path: str | None = None
    deploy_cmd: str | None = None
    delete_files: bool = False


class WizardBody(BaseModel):
    kind: str = "custom"
    name: str | None = None
    paths: list[str] = []
    mysql: list[str] = []
    pgsql: list[str] = []
    label: str = ""


@app.get("/api/images/info")
def api_images_info(path: str = "", user: str = auth.CurrentUser):
    return _files_call(lambda: {"available": images.available(), **(images.info(path) if images.available() else {})})


@app.post("/api/images/scale")
def api_images_scale(body: ImageOpBody, user: str = auth.CurrentUser):
    return _files_call(lambda: images.scale(body.path, body.width, body.height, body.percent, body.keep_aspect, body.keep_original, body.quality))


@app.post("/api/images/thumbnails")
def api_images_thumbs(body: ImageOpBody, user: str = auth.CurrentUser):
    return _files_call(lambda: {"job": images.thumbnails(body.path, body.percent, body.max_px, body.recursive).id})


@app.post("/api/images/convert")
def api_images_convert(body: ImageOpBody, user: str = auth.CurrentUser):
    return _files_call(lambda: {"job": images.convert(body.path, body.to or "", body.quality, body.delete_original).id})


@app.get("/api/webdisk")
def api_webdisk(user: str = auth.CurrentUser):
    return webaccess.webdisk_list()


@app.post("/api/webdisk")
def api_webdisk_create(body: WebAccessBody, user: str = auth.CurrentUser):
    return _files_call(lambda: webaccess.webdisk_create(body.name or "", body.password or "", body.path or "", bool(body.readonly)))


@app.post("/api/webdisk/update")
def api_webdisk_update(body: WebAccessBody, user: str = auth.CurrentUser):
    return _files_call(lambda: webaccess.webdisk_update(body.name or "", body.path, body.readonly, body.disabled, body.password))


@app.post("/api/webdisk/delete")
def api_webdisk_delete(body: WebAccessBody, user: str = auth.CurrentUser):
    return _files_call(lambda: webaccess.webdisk_delete(body.name or ""))


class WebdiskCertBody(BaseModel):
    host: str = ""


@app.get("/api/webdisk/certificate")
def api_webdisk_certificate(host: str = "", user: str = auth.CurrentUser):
    return _files_call(lambda: webaccess.webdisk_certificate(host))


@app.post("/api/webdisk/certificate")
def api_webdisk_certificate_create(body: WebdiskCertBody, user: str = auth.CurrentUser):
    return _files_call(lambda: webaccess.webdisk_certificate_ensure(body.host))


@app.get("/api/dirprivacy")
def api_dirprivacy(user: str = auth.CurrentUser):
    return webaccess.privacy_list()


@app.post("/api/dirprivacy/protect")
def api_dirprivacy_protect(body: WebAccessBody, user: str = auth.CurrentUser):
    return _files_call(lambda: webaccess.privacy_protect(body.path or "", body.label or "", body.name or "", body.password or ""))


@app.post("/api/dirprivacy/user")
def api_dirprivacy_user(body: WebAccessBody, user: str = auth.CurrentUser):
    return _files_call(lambda: webaccess.privacy_user(body.path or "", body.name or "", body.password, body.remove))


@app.post("/api/dirprivacy/toggle")
def api_dirprivacy_toggle(body: WebAccessBody, user: str = auth.CurrentUser):
    return _files_call(lambda: webaccess.privacy_toggle(body.path or "", bool(body.enabled)))


@app.post("/api/dirprivacy/remove")
def api_dirprivacy_remove(body: WebAccessBody, user: str = auth.CurrentUser):
    return _files_call(lambda: webaccess.privacy_remove(body.path or ""))


@app.get("/api/git")
def api_git(user: str = auth.CurrentUser):
    return _files_call(gitvc.listing)


@app.get("/api/git/{name}")
def api_git_details(name: str, user: str = auth.CurrentUser):
    return _files_call(lambda: gitvc.details(name))


@app.post("/api/git/key")
def api_git_key(body: GitBody, user: str = auth.CurrentUser):
    return _files_call(lambda: gitvc.make_key(body.name, body.owner or ""))


@app.post("/api/git/create")
def api_git_create(body: GitBody, user: str = auth.CurrentUser):
    return _files_call(lambda: {"job": gitvc.create(body.name, body.path or "", body.owner or "", body.clone_url, body.branch, body.use_key).id})


@app.post("/api/git/pull")
def api_git_pull(body: GitBody, user: str = auth.CurrentUser):
    return _files_call(lambda: {"job": gitvc.pull(body.name).id})


@app.post("/api/git/checkout")
def api_git_checkout(body: GitBody, user: str = auth.CurrentUser):
    return _files_call(lambda: gitvc.checkout(body.name, body.branch or ""))


@app.post("/api/git/deploy-settings")
def api_git_deploy_settings(body: GitBody, user: str = auth.CurrentUser):
    return _files_call(lambda: gitvc.set_deploy(body.name, body.deploy_path or "", body.deploy_cmd or ""))


@app.post("/api/git/deploy")
def api_git_deploy(body: GitBody, user: str = auth.CurrentUser):
    return _files_call(lambda: {"job": gitvc.deploy(body.name).id})


@app.post("/api/git/remove")
def api_git_remove(body: GitBody, user: str = auth.CurrentUser):
    return _files_call(lambda: gitvc.remove(body.name, body.delete_files))


@app.get("/api/backups/wizard")
def api_backup_wizard(user: str = auth.CurrentUser):
    return _files_call(backups.wizard_options)


@app.post("/api/backups/wizard")
def api_backup_wizard_create(body: WizardBody, user: str = auth.CurrentUser):
    return _files_call(lambda: {"job": backups.wizard_create(body.kind, body.paths, body.mysql, body.pgsql, body.label).id})


@app.get("/api/backups/manifest")
def api_backup_manifest(name: str, user: str = auth.CurrentUser):
    return _files_call(lambda: backups.manifest(name))


@app.post("/api/backups/wizard/restore")
def api_backup_wizard_restore(body: WizardBody, user: str = auth.CurrentUser):
    return _files_call(lambda: {"job": backups.wizard_restore(body.name or "", body.paths, body.mysql, body.pgsql).id})


@app.get("/api/inodes")
def api_inodes(path: str = "/", user: str = auth.CurrentUser):
    return _files_call(lambda: diskusage.inodes(path))


# --------------------------------------------------------------------------- #
# System Applications: per-app configuration + FTP accounts
# --------------------------------------------------------------------------- #
def _cfg_call(fn):
    try:
        return fn()
    except (appconfig.AppConfigError, ftp.FTPError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class AppSettingsBody(BaseModel):
    changes: dict


class AppModuleBody(BaseModel):
    name: str
    on: bool


class AppFileBody(BaseModel):
    path: str
    content: str


class FTPAccountBody(BaseModel):
    name: str
    password: str | None = None
    folder: str | None = None
    access: str | None = None
    create_folder: bool = True
    enabled: bool | None = None


@app.get("/api/sysapps/{app_id}/config")
def api_appcfg_info(app_id: str, user: str = auth.CurrentUser):
    return _cfg_call(lambda: appconfig.info(app_id))


@app.get("/api/sysapps/{app_id}/settings")
def api_appcfg_settings(app_id: str, user: str = auth.CurrentUser):
    return _cfg_call(lambda: appconfig.settings(app_id))


@app.post("/api/sysapps/{app_id}/settings")
def api_appcfg_save(app_id: str, body: AppSettingsBody, user: str = auth.CurrentUser):
    return _cfg_call(lambda: appconfig.save(app_id, body.changes))


@app.get("/api/sysapps/{app_id}/modules")
def api_appcfg_modules(app_id: str, user: str = auth.CurrentUser):
    return _cfg_call(lambda: {"modules": appconfig.modules(app_id)})


@app.post("/api/sysapps/{app_id}/modules")
def api_appcfg_module(app_id: str, body: AppModuleBody, user: str = auth.CurrentUser):
    return _cfg_call(lambda: appconfig.set_module(app_id, body.name, body.on))


@app.get("/api/sysapps/{app_id}/file")
def api_appcfg_file(app_id: str, path: str, user: str = auth.CurrentUser):
    return _cfg_call(lambda: appconfig.read_file(app_id, path))


@app.post("/api/sysapps/{app_id}/file")
def api_appcfg_file_save(app_id: str, body: AppFileBody, user: str = auth.CurrentUser):
    return _cfg_call(lambda: appconfig.write_file(app_id, body.path, body.content))


@app.get("/api/sysapps/{app_id}/logs")
def api_appcfg_logs(app_id: str, source: str | None = None, lines: int = 200, user: str = auth.CurrentUser):
    return _cfg_call(lambda: appconfig.logs(app_id, source, lines))


@app.get("/api/ftp/accounts")
def api_ftp_accounts(user: str = auth.CurrentUser):
    if not ftp.installed():
        return {"installed": False, "accounts": []}
    return _cfg_call(lambda: {"installed": True, **ftp.accounts()})


@app.post("/api/ftp/accounts")
def api_ftp_create(body: FTPAccountBody, user: str = auth.CurrentUser):
    return _cfg_call(lambda: ftp.create(body.name, body.password or "", body.folder or "", body.access or "full", body.create_folder))


@app.post("/api/ftp/accounts/password")
def api_ftp_password(body: FTPAccountBody, user: str = auth.CurrentUser):
    return _cfg_call(lambda: ftp.set_password(body.name, body.password or ""))


@app.post("/api/ftp/accounts/modify")
def api_ftp_modify(body: FTPAccountBody, user: str = auth.CurrentUser):
    return _cfg_call(lambda: ftp.modify(body.name, body.folder, body.access, body.create_folder))


@app.post("/api/ftp/accounts/toggle")
def api_ftp_toggle(body: FTPAccountBody, user: str = auth.CurrentUser):
    return _cfg_call(lambda: ftp.set_enabled(body.name, bool(body.enabled)))


@app.post("/api/ftp/accounts/delete")
def api_ftp_delete(body: FTPAccountBody, user: str = auth.CurrentUser):
    return _cfg_call(lambda: ftp.delete(body.name))


# --------------------------------------------------------------------------- #
# About & updates (the update check only runs when the admin asks for it)
# --------------------------------------------------------------------------- #
@app.get("/api/about")
def api_about(user: str = auth.CurrentUser):
    return version.info()


@app.post("/api/about/check")
def api_about_check(user: str = auth.CurrentUser):
    try:
        return version.check()
    except version.UpdateError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/about/changelog")
def api_about_changelog(user: str = auth.CurrentUser):
    try:
        return version.changelog()
    except version.UpdateError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/about/update")
def api_about_update(user: str = auth.CurrentUser):
    try:
        return version.apply_update()
    except version.UpdateError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/about/update")
def api_about_update_status(user: str = auth.CurrentUser):
    return version.update_status()


# --------------------------------------------------------------------------- #
# Preferences: account
# --------------------------------------------------------------------------- #
class PasswordChangeBody(BaseModel):
    current: str
    new_password: str


class PrefsBody(BaseModel):
    contact_email: str | None = None
    language: str | None = None
    default_theme: str | None = None


class RenameBody(BaseModel):
    username: str


@app.get("/api/account/prefs")
def api_prefs(user: str = auth.CurrentUser):
    return config.get_prefs()


@app.post("/api/account/prefs")
def api_prefs_set(body: PrefsBody, user: str = auth.CurrentUser):
    return config.set_prefs(contact_email=body.contact_email, language=body.language, default_theme=body.default_theme)


@app.post("/api/account/password")
def api_account_password(body: PasswordChangeBody, request: Request, user: str = auth.CurrentUser):
    prefs = config.get_prefs()
    if not config.verify_credentials(prefs["username"], body.current):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    config.change_password(body.new_password)
    # change_password rotated the signing secret, which signs out every other
    # session; hand this browser a fresh cookie so it stays logged in.
    resp = JSONResponse({"ok": True})
    _set_session(resp, request, prefs["username"])
    return resp


@app.post("/api/account/rename")
def api_account_rename(body: RenameBody, user: str = auth.CurrentUser):
    if not body.username.strip():
        raise HTTPException(status_code=400, detail="Username required")
    config.rename_user(body.username.strip())
    return {"ok": True, "username": body.username.strip()}


# --------------------------------------------------------------------------- #
# Terminal (WebSocket PTY)
# --------------------------------------------------------------------------- #
@app.websocket("/api/terminal/ws")
async def api_terminal(websocket: WebSocket):
    # Authenticate via the same session cookie before accepting.
    token = websocket.cookies.get(auth.COOKIE_NAME)
    if not token or not auth.verify_token(token):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    try:
        await terminal.run(websocket)
    except WebSocketDisconnect:
        pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# --------------------------------------------------------------------------- #
# Static frontend (mounted last so /api takes precedence)
# --------------------------------------------------------------------------- #
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
