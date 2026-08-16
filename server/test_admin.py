"""
Yönetici (admin) rolü + panel yetkilendirmesi — entegrasyon testi.

Gerçek sunucuyu geçici DB ile ayağa kaldırır ve şunları doğrular:
  1. Normal kullanıcı / token'sız istek → /admin/* 403 (korumasız uç yok).
  2. Yetkisiz her deneme denetim kaydına (admin_audit) yazılır.
  3. Rol atanınca (manuel SQL VEYA bootstrap env) admin uçları 200.
  4. Admin başka kullanıcının rolünü değiştirebilir → işlem denetlenir;
     yetki düşünce (admin→user) o kullanıcının oturumları kapanır.
  5. Normal kullanıcı hiçbir yönetim işlemi yapamaz (set_role 403).
  6. Admin oturumu KISA ömürlüdür: eskimiş admin oturumu reddedilir.
  7. GAME2048_ADMIN_BOOTSTRAP env'i mevcut kullanıcıyı admin yapar (idempotent).

Çalıştır:  python server/test_admin.py
"""
import json
import os
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ["GAME2048_DB"] = _tmp.name

import app  # noqa: E402
from http.server import ThreadingHTTPServer  # noqa: E402

app.init_db()
_srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
PORT = _srv.server_address[1]
threading.Thread(target=_srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{PORT}"


def call(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def register(username, password="parola123"):
    st, j = call("POST", "/register", {
        "username": username, "password": password,
        "email": f"{username}@test.com", "data": {},
    })
    assert st == 200, f"kayıt başarısız: {st} {j}"
    return j["token"]


def promote_sql(username):
    """Belgelenen 'elle SQL' yolu ile admin yap."""
    conn = app.db()
    conn.execute("UPDATE users SET role='admin' WHERE username_lower = ?", (username.lower(),))
    conn.commit()
    conn.close()


def main():
    fails = []

    def check(name, cond, detail=""):
        print(f"{'OK ' if cond else 'X  '} {name}{'' if cond else '  -> ' + detail}")
        if not cond:
            fails.append(name)

    tu = register("normal")

    # --- 1) Yetki yoksa /admin/* 403 ---
    st, j = call("GET", "/admin/whoami", None, tu)
    check("normal kullanıcı /admin/whoami reddedilir (403)", st == 403, f"{st} {j}")
    st, j = call("GET", "/admin/whoami")
    check("token'sız /admin/whoami reddedilir (403)", st == 403, f"{st} {j}")
    st, j = call("GET", "/admin/audit", None, tu)
    check("normal kullanıcı /admin/audit reddedilir (403)", st == 403, f"{st} {j}")

    # --- 3) Rol atanınca admin uçları açılır (elle SQL yolu) ---
    promote_sql("normal")
    st, j = call("GET", "/admin/whoami", None, tu)
    check("admin /admin/whoami 200 + role=admin", st == 200 and j.get("role") == "admin" and j.get("admin") is True, f"{st} {j}")

    # --- 4) Admin rol atar → denetlenir ---
    tv = register("hedef")
    st, j = call("POST", "/admin/users/role", {"username": "hedef", "role": "admin"}, tu)
    check("admin set_role(admin) 200", st == 200 and j.get("role") == "admin", f"{st} {j}")

    # --- 5) Normal kullanıcı yönetim işlemi yapamaz ---
    tw = register("baskasi")
    st, j = call("POST", "/admin/users/role", {"username": "hedef", "role": "user"}, tw)
    check("normal kullanıcı set_role reddedilir (403)", st == 403, f"{st} {j}")

    # --- Yetki düşünce (admin→user) oturum kapanır ---
    st, j = call("POST", "/admin/users/role", {"username": "hedef", "role": "user"}, tu)
    check("admin hedef'i düşürür (200)", st == 200, f"{st} {j}")
    st, j = call("GET", "/admin/whoami", None, tv)
    check("düşürülen hedef artık admin değil (403)", st == 403, f"{st} {j}")
    st, j = call("GET", "/me", None, tv)
    check("düşürülen kullanıcının oturumu kapandı (/me 401)", st == 401, f"{st} {j}")

    # --- 2) Denetim kaydı: işlemler + yetkisiz denemeler ---
    st, j = call("GET", "/admin/audit", None, tu)
    actions = {e["action"] for e in j.get("entries", [])}
    check("denetim kaydında set_role işlemi var", "set_role" in actions, str(actions))
    check("denetim kaydında yetkisiz deneme kaydı var", "unauthorized_admin_access" in actions, str(actions))

    # --- 6) Admin oturumu KISA ömürlü: eskimiş oturum reddedilir ---
    stale = "a" * 64
    conn = app.db()
    uid = conn.execute("SELECT id FROM users WHERE username_lower='normal'").fetchone()["id"]
    conn.execute("INSERT INTO sessions (token, user_id, created) VALUES (?,?,?)",
                 (stale, uid, int(time.time()) - app.ADMIN_SESSION_TTL - 100))
    conn.commit()
    conn.close()
    st, j = call("GET", "/admin/whoami", None, stale)
    check("eskimiş admin oturumu reddedilir (403)", st == 403, f"{st} {j}")

    # --- 7) Bootstrap env mevcut kullanıcıyı admin yapar ---
    tb = register("bootme")
    app.ADMIN_BOOTSTRAP = "bootme"
    app.init_db()  # idempotent; var olan kullanıcıyı admin yapar
    st, j = call("GET", "/admin/whoami", None, tb)
    check("GAME2048_ADMIN_BOOTSTRAP kullanıcıyı admin yaptı", st == 200 and j.get("role") == "admin", f"{st} {j}")

    print()
    if fails:
        print("[X] BASARISIZ:", ", ".join(fails))
        sys.exit(1)
    print("[OK] TUM DOGRULAMALAR GECTI - admin rolu + panel yetkilendirmesi guvenli")


if __name__ == "__main__":
    try:
        main()
    finally:
        _srv.shutdown()
        try:
            os.unlink(_tmp.name)
        except OSError:
            pass
