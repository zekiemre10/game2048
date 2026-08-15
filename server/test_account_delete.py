"""
Hesap silme (/account/delete) + çıkış (/logout) — entegrasyon testi.

Gerçek sunucuyu geçici DB ile ayağa kaldırır ve şunları doğrular:
  1. /account/delete TOKEN'SİZ → 401 (oturum gerekli).
  2. /account/delete YANLIŞ şifre → 403; hesap SİLİNMEZ (/me hâlâ 200).
  3. /account/delete DOĞRU şifre → 200; oturum geçersizleşir (/me → 401),
     eski parolayla giriş artık BAŞARISIZ (hesap yok).
  4. Silinen kullanıcı adı YENİDEN kullanılabilir (aynı adla kayıt tekrar 200).
     — Bu, "hesabım silinince aynı adla yeni hesap açabildim" davranışını sabitler.
  5. /logout token'ı geçersiz kılar (/me → 401).

Çalıştır:  python server/test_account_delete.py
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

# Geçici DB ile başlat (üretim verisine dokunma)
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


def register(username, password="parola123", email=None):
    st, j = call("POST", "/register", {
        "username": username, "password": password,
        "email": email or f"{username}@test.com", "data": {},
    })
    assert st == 200, f"kayıt başarısız: {st} {j}"
    return j["token"]


def main():
    fails = []

    def check(name, cond, detail=""):
        print(f"{'OK ' if cond else 'X  '} {name}{'' if cond else '  -> ' + detail}")
        if not cond:
            fails.append(name)

    # --- Hazırlık: hesap oluştur ---
    token = register("silinecek", "dogruParola1")
    st, _ = call("GET", "/me", None, token)
    check("hesap kuruldu (/me 200)", st == 200, str(st))

    # --- 1) Token'sız silme → 401 ---
    st, j = call("POST", "/account/delete", {"password": "dogruParola1"})
    check("token'sız silme reddedilir (401)", st == 401, f"{st} {j}")

    # --- 2) Yanlış şifre → 403; hesap durur ---
    st, j = call("POST", "/account/delete", {"password": "yanlis"}, token)
    check("yanlış şifre reddedilir (403)", st == 403, f"{st} {j}")
    st, _ = call("GET", "/me", None, token)
    check("yanlış şifre sonrası hesap DURUYOR (/me 200)", st == 200, str(st))

    # --- 3) Doğru şifre → 200; oturum ve hesap gider ---
    st, j = call("POST", "/account/delete", {"password": "dogruParola1"}, token)
    check("doğru şifreyle silme başarılı (200 ok)", st == 200 and j.get("ok") is True, f"{st} {j}")
    st, _ = call("GET", "/me", None, token)
    check("silme sonrası oturum geçersiz (/me 401)", st == 401, str(st))
    st, j = call("POST", "/login", {"username": "silinecek", "password": "dogruParola1"})
    check("silinen hesaba giriş BAŞARISIZ", st != 200 and "token" not in j, f"{st} {j}")

    # --- 4) Kullanıcı adı yeniden kullanılabilir (aynı adla kayıt tekrar) ---
    st, j = call("POST", "/register", {
        "username": "silinecek", "password": "yeniParola2",
        "email": "silinecek-yeni@test.com", "data": {},
    })
    check("silinen kullanıcı adı yeniden kayıt olabilir (200)", st == 200 and "token" in j, f"{st} {j}")

    # --- 5) /logout token'ı geçersiz kılar ---
    t2 = register("cikanuser", "parolaX")
    st, _ = call("GET", "/me", None, t2)
    check("çıkış öncesi /me 200", st == 200, str(st))
    st, _ = call("POST", "/logout", None, t2)
    check("logout 200", st == 200, str(st))
    st, _ = call("GET", "/me", None, t2)
    check("logout sonrası token geçersiz (/me 401)", st == 401, str(st))

    print()
    if fails:
        print("[X] BASARISIZ:", ", ".join(fails))
        sys.exit(1)
    print("[OK] TUM DOGRULAMALAR GECTI - hesap silme + cikis guvenli")


if __name__ == "__main__":
    try:
        main()
    finally:
        _srv.shutdown()
        try:
            os.unlink(_tmp.name)
        except OSError:
            pass
