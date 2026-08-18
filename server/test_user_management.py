"""
Kullanıcı yönetimi — arama / detay / moderasyon / dışa aktarma / silme testi.

Doğrular:
  1. YETKİ: normal kullanıcı tüm /admin/users* uçlarına 403.
  2. ARAMA: ada/e-posta/tarihle bulunur; sonuç parola HASH'İ İÇERMEZ.
  3. DETAY: hesap+skor+arkadaş+şikayet+moderasyon geçmişi; hash İÇERMEZ.
  4. GEREKÇE ZORUNLU: gerekçesiz moderasyon 400.
  5. SÜRELİ ASKI: minutes ile askı → suspended_until; giriş ANLAMLI mesajla (reason+until) 403.
  6. OTOMATİK BİTİŞ: süre geçince giriş otomatik açılır (askı kalkar).
  7. KALICI ASKI: minutes'suz askı until=0; giriş 403. unsuspend → giriş açılır.
  8. DIŞA AKTARMA: kullanıcının kendi verisi döner; hash yok.
  9. SİLME: gerekçe zorunlu + çift onay (confirmUsername) + admin silinemez;
     başarılı silmede kullanıcı gider, girişi düşer, denetime yazılır.
 10. GÜVENLİK: hiçbir admin yanıtı pwhash/salt/pbkdf2 sızdırmaz.

Çalıştır:  python server/test_user_management.py
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
        "username": username, "password": password, "email": f"{username}@test.com", "data": {},
    })
    assert st == 200, f"kayıt: {st} {j}"
    return j["token"], j["user"]["id"]


def promote_admin(username):
    conn = app.db()
    conn.execute("UPDATE users SET role='admin' WHERE username_lower=?", (username.lower(),))
    conn.commit()
    conn.close()


def no_secret(obj):
    s = json.dumps(obj).lower()
    return "pwhash" not in s and "salt" not in s and "pbkdf2" not in s


def main():
    fails = []

    def check(name, cond, detail=""):
        print(f"{'OK ' if cond else 'X  '} {name}{'' if cond else '  -> ' + detail}")
        if not cond:
            fails.append(name)

    ta, A = register("alice")
    tb, B = register("bob")
    tm, M = register("useradmin")
    promote_admin("useradmin")

    # --- 1) YETKİ ---
    st, _ = call("GET", "/admin/users", token=tb)
    check("normal kullanıcı /admin/users 403", st == 403, str(st))
    st, _ = call("GET", "/admin/users/detail?id=" + str(A), token=tb)
    check("normal kullanıcı detail 403", st == 403, str(st))

    # --- 2) ARAMA ---
    st, j = call("GET", "/admin/users?q=alice", token=tm)
    unames = [u["username"] for u in j.get("users", [])]
    check("ada ile arama bulur", st == 200 and "alice" in unames, f"{st} {unames}")
    check("arama sonucu parola hash içermez", no_secret(j), "sızıntı")
    st, j = call("GET", "/admin/users?q=bob@test.com", token=tm)
    check("e-posta ile arama bulur", any(u["username"] == "bob" for u in j.get("users", [])), str(j))
    today = time.strftime("%Y-%m-%d", time.gmtime())
    st, j = call("GET", f"/admin/users?from={today}", token=tm)
    check("kayıt tarihi (bugün) filtresi çalışır", st == 200 and j["count"] >= 3, str(j.get("count")))

    # --- 3) DETAY ---
    st, j = call("GET", f"/admin/users/detail?id={A}", token=tm)
    check("detay hesap+skor+geçmiş döner",
          st == 200 and "account" in j and "scores" in j and "modHistory" in j and "reports" in j,
          str(list(j.keys())))
    check("detay parola hash içermez", no_secret(j), "sızıntı")

    # --- 4) GEREKÇE ZORUNLU ---
    st, j = call("POST", "/admin/users/moderate", {"username": "alice", "action": "warn"}, tm)
    check("gerekçesiz uyarı 400", st == 400 and j.get("error") == "reason_required", f"{st} {j}")

    # --- 5) SÜRELİ ASKI + anlamlı mesaj ---
    st, j = call("POST", "/admin/users/moderate",
                 {"username": "alice", "action": "suspend", "minutes": 60, "reason": "kural ihlali"}, tm)
    check("süreli askı 200 + until set", st == 200 and j.get("until"), f"{st} {j}")
    st, j = call("POST", "/login", {"username": "alice", "password": "parola123"})
    check("askılı giriş 403 + reason + until", st == 403 and j.get("error") == "suspended"
          and j.get("reason") == "kural ihlali" and j.get("until"), f"{st} {j}")

    # --- 6) OTOMATİK BİTİŞ ---
    conn = app.db()
    conn.execute("UPDATE users SET suspended_until=? WHERE id=?", (int(time.time()) - 10, A))
    conn.commit()
    conn.close()
    st, j = call("POST", "/login", {"username": "alice", "password": "parola123"})
    check("süre geçince giriş otomatik açılır", st == 200 and j.get("token"), f"{st} {j}")

    # --- 7) KALICI ASKI + unsuspend ---
    st, j = call("POST", "/admin/users/moderate",
                 {"username": "alice", "action": "suspend", "reason": "kalıcı"}, tm)
    check("kalıcı askı until=0", st == 200 and (j.get("until") in (0, None)), f"{st} {j}")
    st, j = call("POST", "/login", {"username": "alice", "password": "parola123"})
    check("kalıcı askıda giriş 403", st == 403 and j.get("error") == "suspended", f"{st} {j}")
    st, _ = call("POST", "/admin/users/moderate",
                 {"username": "alice", "action": "unsuspend", "reason": "itiraz kabul"}, tm)
    st, j = call("POST", "/login", {"username": "alice", "password": "parola123"})
    check("unsuspend sonrası giriş açılır", st == 200 and j.get("token"), f"{st} {j}")

    # --- 8) DIŞA AKTARMA ---
    st, j = call("GET", f"/admin/users/export?id={A}", token=tm)
    exp = j.get("export", {})
    check("dışa aktarma kullanıcının verisini döner",
          st == 200 and exp.get("account", {}).get("username") == "alice"
          and "progress" in exp and "monthlyScores" in exp, str(list(exp.keys())))
    check("dışa aktarma parola hash içermez", no_secret(j), "sızıntı")

    # --- 9) SİLME (çift onay) ---
    td, D = register("deltarget")
    st, j = call("POST", "/admin/users/delete", {"id": D, "confirmUsername": "deltarget"}, tm)
    check("gerekçesiz silme 400", st == 400 and j.get("error") == "reason_required", f"{st} {j}")
    st, j = call("POST", "/admin/users/delete",
                 {"id": D, "reason": "istek", "confirmUsername": "yanlis"}, tm)
    check("yanlış onayla silme 400", st == 400 and j.get("error") == "confirm_mismatch", f"{st} {j}")
    st, j = call("POST", "/admin/users/delete",
                 {"id": M, "reason": "x", "confirmUsername": "useradmin"}, tm)
    check("admin silinemez 403", st == 403 and j.get("error") == "cannot_delete_admin", f"{st} {j}")
    st, j = call("POST", "/admin/users/delete",
                 {"id": D, "reason": "kullanıcı talebi", "confirmUsername": "deltarget"}, tm)
    check("çift onaylı silme 200", st == 200 and j.get("deleted") == "deltarget", f"{st} {j}")
    st, j = call("POST", "/login", {"username": "deltarget", "password": "parola123"})
    check("silinen kullanıcı giriş yapamaz", st == 401, f"{st} {j}")

    # --- 10) GÜVENLİK: denetim + sızıntı yok ---
    conn = app.db()
    acts = [r["action"] for r in conn.execute("SELECT action FROM admin_audit")]
    conn.close()
    check("silme denetime yazıldı", "user_delete" in acts, str(set(acts)))
    check("dışa aktarma denetime yazıldı", "user_export" in acts, str(set(acts)))
    check("askı denetime yazıldı", any(a.startswith("moderate:suspend") for a in acts), str(set(acts)))

    print()
    if fails:
        print(f"BAŞARISIZ: {len(fails)} kontrol geçmedi -> {fails}")
        sys.exit(1)
    print("TÜM KONTROLLER GEÇTİ ✓ — kullanıcı yönetimi")


if __name__ == "__main__":
    try:
        main()
    finally:
        try:
            os.unlink(_tmp.name)
        except OSError:
            pass
