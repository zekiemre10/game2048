"""
Gizlilik / veri sorumluluğu — entegrasyon testi.

Doğrular:
  1. E-posta İSTEĞE BAĞLI: e-postasız kayıt olur; geçersiz e-posta 400; geçerli olur.
  2. KENDİ verini indir: GET /account/export (auth) kendi verini döner, hash yok; auth'suz 401.
  3. SAKLAMA: retention_cleanup süresi dolan mesaj/olay/denetimi siler, yenisini korur.
  4. SİLME kapsamı: kendi hesabını silince mesaj/arkadaşlık/engel/bildirim/aktiflik gider.

Çalıştır:  python server/test_privacy.py
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


def main():
    fails = []

    def check(name, cond, detail=""):
        print(f"{'OK ' if cond else 'X  '} {name}{'' if cond else '  -> ' + detail}")
        if not cond:
            fails.append(name)

    # --- 1) E-POSTA İSTEĞE BAĞLI ---
    st, j = call("POST", "/register", {"username": "noemail", "password": "parola123", "data": {}})
    check("e-postasız kayıt olur (200)", st == 200 and j.get("token"), f"{st} {j}")
    tok = j.get("token")
    st, j = call("POST", "/register",
                 {"username": "bademail", "password": "parola123", "email": "not-an-email", "data": {}})
    check("geçersiz e-posta reddedilir (400)", st == 400 and j.get("error") == "invalid_email", f"{st} {j}")
    st, j = call("POST", "/register",
                 {"username": "withemail", "password": "parola123", "email": "a@b.com", "data": {}})
    check("geçerli e-posta ile kayıt olur", st == 200, f"{st} {j}")

    # --- 2) KENDİ VERİNİ İNDİR ---
    st, j = call("GET", "/account/export")  # auth yok
    check("auth'suz export 401", st == 401, str(st))
    st, j = call("GET", "/account/export", token=tok)
    exp = j.get("export", {})
    blob = json.dumps(j).lower()
    check("kendi verini indir: hesap + ilerleme döner",
          st == 200 and exp.get("account", {}).get("username") == "noemail" and "progress" in exp,
          str(list(exp.keys())))
    check("export parola hash içermez", "pwhash" not in blob and "salt" not in blob, "sızıntı")

    # --- 3) SAKLAMA SÜRESİ ---
    conn = app.db()
    now = int(time.time())
    old = now - 200 * 86400
    conn.execute("INSERT INTO messages (from_id,to_id,body,created) VALUES (1,2,'eski',?)", (old,))
    conn.execute("INSERT INTO messages (from_id,to_id,body,created) VALUES (1,2,'yeni',?)", (now,))
    conn.execute("INSERT INTO events (ts,name,mode) VALUES (?,?,?)", (now - 100 * 86400, "game_start", "classic"))
    conn.execute("INSERT INTO events (ts,name,mode) VALUES (?,?,?)", (now, "game_start", "zen"))
    conn.execute("INSERT INTO admin_audit (action,created) VALUES (?,?)", ("old_action", now - 400 * 86400))
    conn.commit()
    counts = app.retention_cleanup(conn)
    msgs = conn.execute("SELECT COUNT(*) AS n FROM messages").fetchone()["n"]
    evs = conn.execute("SELECT COUNT(*) AS n FROM events").fetchone()["n"]
    aud = conn.execute("SELECT COUNT(*) AS n FROM admin_audit WHERE action='old_action'").fetchone()["n"]
    conn.close()
    check("eski mesaj silinir, yeni kalır", msgs == 1 and counts["messages"] == 1, f"msgs={msgs} {counts}")
    check("eski olay silinir, yeni kalır", evs == 1 and counts["events"] == 1, f"evs={evs}")
    check("eski denetim kaydı silinir (1 yıl)", aud == 0 and counts["admin_audit"] == 1, f"aud={aud}")

    # --- 4) SİLME KAPSAMI ---
    ta, A = None, None
    st, j = call("POST", "/register", {"username": "todelete", "password": "parola123", "data": {}})
    ta = j["token"]; A = j["user"]["id"]
    st, j2 = call("POST", "/register", {"username": "friend", "password": "parola123", "data": {}})
    tb, B = j2["token"], j2["user"]["id"]
    call("POST", "/friends/request", {"id": B}, ta)
    call("POST", "/friends/request", {"id": A}, tb)
    call("POST", "/messages", {"to": B, "body": "selam"}, ta)
    call("POST", "/block", {"targetId": B}, ta)
    conn = app.db()
    conn.execute("INSERT INTO mod_notices (user_id,action,reason,created) VALUES (?,?,?,?)",
                 (A, "warn", "test", int(time.time())))
    conn.execute("INSERT OR IGNORE INTO user_activity (user_id,day) VALUES (?, '2020-01-01')", (A,))
    conn.commit(); conn.close()
    st, _ = call("POST", "/account/delete", {"password": "parola123"}, ta)
    check("kendi hesabını siler (200)", st == 200, str(st))
    conn = app.db()
    left = {
        "messages": conn.execute("SELECT COUNT(*) AS n FROM messages WHERE from_id=? OR to_id=?", (A, A)).fetchone()["n"],
        "friendships": conn.execute("SELECT COUNT(*) AS n FROM friendships WHERE requester_id=? OR addressee_id=?", (A, A)).fetchone()["n"],
        "blocks": conn.execute("SELECT COUNT(*) AS n FROM blocks WHERE blocker_id=? OR blocked_id=?", (A, A)).fetchone()["n"],
        "mod_notices": conn.execute("SELECT COUNT(*) AS n FROM mod_notices WHERE user_id=?", (A,)).fetchone()["n"],
        "user_activity": conn.execute("SELECT COUNT(*) AS n FROM user_activity WHERE user_id=?", (A,)).fetchone()["n"],
        "users": conn.execute("SELECT COUNT(*) AS n FROM users WHERE id=?", (A,)).fetchone()["n"],
    }
    conn.close()
    check("silmede tüm ilişkili veri gider", all(v == 0 for v in left.values()), str(left))

    print()
    if fails:
        print(f"BAŞARISIZ: {len(fails)} -> {fails}")
        sys.exit(1)
    print("TÜM KONTROLLER GEÇTİ ✓ — gizlilik / veri sorumluluğu")


if __name__ == "__main__":
    try:
        main()
    finally:
        try:
            os.unlink(_tmp.name)
        except OSError:
            pass
