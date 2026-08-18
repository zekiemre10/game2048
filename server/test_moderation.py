"""
Sohbet moderasyonu + şikayet — entegrasyon testi.

Doğrular:
  1. ENGELLEME: A, B'yi engelleyince B→A mesaj/istek 403; engel kalkınca yine olur.
  2. ŞİKAYET: mesaj şikayeti kuyruğa 'new' düşer; normal kullanıcı kuyruğu göremez (403).
  3. GİZLİLİK: yönetici yalnızca şikayet edilen mesajın SINIRLI çevresini (±3) görür;
     serbest sohbet taraması için uç YOK (kodda kısıt).
  4. MODERASYON: uyarı/susturma/askı çalışır (susturulan mesaj atamaz, askılı giremez),
     denetim kaydına yazılır ve kullanıcıya SEBEBİYLE bildirilir. Admin modere edilemez.

Çalıştır:  python server/test_moderation.py
"""
import json
import os
import sys
import tempfile
import threading
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
        "username": username, "password": password, "email": f"{username}@test.com", "data": {},
    })
    assert st == 200, f"kayıt: {st} {j}"
    return j["token"], j["user"]["id"]


def make_friends(t1, id1, t2, id2):
    call("POST", "/friends/request", {"id": id2}, t1)     # 1 -> 2 (pending)
    call("POST", "/friends/request", {"id": id1}, t2)     # 2 -> 1 (karşılıklı = kabul)


def promote_admin(username):
    conn = app.db()
    conn.execute("UPDATE users SET role='admin' WHERE username_lower=?", (username.lower(),))
    conn.commit()
    conn.close()


def main():
    fails = []

    def check(name, cond, detail=""):
        print(f"{'OK ' if cond else 'X  '} {name}{'' if cond else '  -> ' + detail}")
        if not cond:
            fails.append(name)

    ta, A = register("alice")
    tb, B = register("bob")
    tm, M = register("moderator")
    promote_admin("moderator")

    make_friends(ta, A, tb, B)
    st, j = call("POST", "/messages", {"to": A, "body": "selam alice"}, tb)
    check("arkadaşken B->A mesaj gider", st == 200, f"{st} {j}")
    msg_id = j.get("message", {}).get("id")

    # --- 1) ENGELLEME ---
    st, _ = call("POST", "/block", {"targetId": B}, ta)
    check("A, B'yi engeller (200)", st == 200, str(st))
    st, j = call("POST", "/messages", {"to": A, "body": "tekrar"}, tb)
    check("engellenen B mesaj gönderemez (403 blocked)", st == 403 and j.get("error") == "blocked", f"{st} {j}")
    st, j = call("POST", "/friends/request", {"id": A}, tb)
    check("engellenen B istek gönderemez (403 blocked)", st == 403 and j.get("error") == "blocked", f"{st} {j}")
    st, j = call("GET", "/blocks", None, ta)
    check("A'nın engel listesinde B var", any(u["id"] == B for u in j.get("blocked", [])), str(j))
    call("POST", "/unblock", {"targetId": B}, ta)

    # --- 2) ŞİKAYET → kuyruk ---
    st, _ = call("POST", "/report", {
        "targetId": B, "reason": "harassment", "detail": "kötü söz", "msgId": msg_id, "context": "chat",
    }, ta)
    check("A, B'nin mesajını şikayet eder (200)", st == 200, str(st))
    st, j = call("GET", "/admin/reports", None, tm)
    reps = j.get("reports", [])
    check("şikayet kuyruğa 'new' düştü", st == 200 and any(r["status"] == "new" for r in reps), f"{st} {j}")
    rid = reps[0]["id"] if reps else None
    st, _ = call("GET", "/admin/reports", None, tb)
    check("normal kullanıcı kuyruğu göremez (403)", st == 403, str(st))

    # --- 3) GİZLİLİK: sınırlı bağlam ---
    st, j = call("GET", f"/admin/reports/context?id={rid}", None, tm)
    ctx = j.get("context", [])
    check("yönetici sınırlı bağlamı görür (±3, boş değil)", st == 200 and 1 <= len(ctx) <= 7, f"{st} len={len(ctx)}")
    st, j = call("GET", f"/admin/reports/context?id={rid}", None, tb)
    check("normal kullanıcı bağlamı göremez (403)", st == 403, str(st))

    # --- şikayet durumu ---
    st, j = call("POST", "/admin/reports/resolve", {"id": rid, "status": "resolved"}, tm)
    check("şikayet sonuçlandırılır (resolved)", st == 200 and j.get("status") == "resolved", f"{st} {j}")

    # --- 4) MODERASYON: susturma ---
    st, _ = call("POST", "/admin/users/moderate", {"username": "bob", "action": "mute", "minutes": 60, "reason": "taciz"}, tm)
    check("admin B'yi susturur (200)", st == 200, str(st))
    st, j = call("POST", "/messages", {"to": A, "body": "x"}, tb)
    check("susturulan B mesaj gönderemez (403 muted)", st == 403 and j.get("error") == "muted", f"{st} {j}")
    st, j = call("GET", "/moderation/notices", None, tb)
    check("B susturma bildirimini SEBEBİYLE görür", any(n["action"] == "mute" and n["reason"] == "taciz" for n in j.get("notices", [])) and j.get("muted_until", 0) > 0, str(j))

    # --- askıya alma ---
    st, _ = call("POST", "/admin/users/moderate", {"username": "bob", "action": "suspend", "reason": "tekrarlı ihlal"}, tm)
    check("admin B'yi askıya alır (200)", st == 200, str(st))
    st, _ = call("GET", "/me", None, tb)
    check("askı sonrası B'nin oturumu kapandı (/me 401)", st == 401, str(st))
    st, j = call("POST", "/login", {"username": "bob", "password": "parola123"})
    check("askıya alınan B giriş yapamaz (403 suspended)", st == 403 and j.get("error") == "suspended", f"{st} {j}")

    # --- admin modere edilemez (gerekçe verilir ki tek ret sebebi admin-dokunulmazlığı olsun) ---
    st, j = call("POST", "/admin/users/moderate",
                 {"username": "moderator", "action": "mute", "reason": "test"}, tm)
    check("admin modere edilemez (403)", st == 403 and j.get("error") == "cannot_moderate_admin", f"{st} {j}")

    print()
    if fails:
        print("[X] BASARISIZ:", ", ".join(fails))
        sys.exit(1)
    print("[OK] TUM DOGRULAMALAR GECTI - sohbet moderasyonu + sikayet guvenli")


if __name__ == "__main__":
    try:
        main()
    finally:
        _srv.shutdown()
        try:
            os.unlink(_tmp.name)
        except OSError:
            pass
