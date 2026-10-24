"""First-run setup, login, sessions, throttle."""
from conftest import ADMIN, PASSWORD
from backend import auth, config


def test_status_before_and_after_setup(client):
    assert client.get("/api/status").json()["initialized"] is False
    assert client.post("/api/setup", json={"username": ADMIN, "password": PASSWORD}).status_code == 200
    assert client.get("/api/status").json()["initialized"] is True


def test_setup_rules(client):
    assert client.post("/api/setup", json={"username": ADMIN, "password": "short"}).status_code == 400
    assert client.post("/api/setup", json={"username": "  ", "password": PASSWORD}).status_code == 400
    assert client.post("/api/setup", json={"username": ADMIN, "password": PASSWORD}).status_code == 200
    # Can't be run twice (would let anyone take over the panel).
    assert client.post("/api/setup", json={"username": "evil", "password": PASSWORD}).status_code == 409


def test_login_wrong_and_right(client):
    client.post("/api/setup", json={"username": ADMIN, "password": PASSWORD})
    assert client.post("/api/login", json={"username": ADMIN, "password": "nope-nope"}).status_code == 401
    assert client.post("/api/login", json={"username": "other", "password": PASSWORD}).status_code == 401
    r = client.post("/api/login", json={"username": ADMIN, "password": PASSWORD})
    assert r.status_code == 200
    assert auth.COOKIE_NAME in r.cookies
    assert client.get("/api/me").json()["username"] == ADMIN


def test_logout_and_bad_tokens(admin):
    assert admin.get("/api/me").status_code == 200
    admin.post("/api/logout")
    admin.cookies.clear()
    assert admin.get("/api/me").status_code == 401
    admin.cookies.set(auth.COOKIE_NAME, "garbage")
    assert admin.get("/api/me").status_code == 401


def test_token_signature_and_rotation():
    config.set_credentials(ADMIN, PASSWORD)
    tok = auth.issue_token(ADMIN)
    assert auth.verify_token(tok) == ADMIN
    payload, sig = tok.rsplit(".", 1)
    assert auth.verify_token(payload + "." + ("0" * len(sig))) is None
    # Changing the password rotates the secret: old sessions stop working.
    config.change_password("another-long-password")
    assert auth.verify_token(tok) is None


def test_login_throttle(client, app_module):
    client.post("/api/setup", json={"username": ADMIN, "password": PASSWORD})
    for _ in range(app_module._LOGIN_MAX_FAILS):
        assert client.post("/api/login", json={"username": ADMIN, "password": "wrong-pass"}).status_code == 401
    r = client.post("/api/login", json={"username": ADMIN, "password": PASSWORD})
    assert r.status_code == 429  # even the right password waits once the limit is hit
