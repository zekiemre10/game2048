"""
Backend SERTLEŞTİRME — entegrasyon testi.

Doğrular:
  1. CORS yalnızca izinli kökene ACAO döner; evil köken engellenir.
  2. Güvenlik başlıkları (nosniff, frame-options, CSP) her yanıtta.
  3. Tüm yazma uç noktalarında hız sınırı → aşılınca 429 (register/message/
     friend/search/room-create).
  4. Yasaklı kelime filtresi kullanıcı adı + sohbette çalışır (TR+EN).
  5. Şikayet (report) çalışır ve reports tablosuna kaydedilir.
  6. Hata yanıtları iç detay sızdırmaz (traceback yok).
  7. Normal oyun akışı etkilenmez.

Çalıştır:  python server/test_hardening.py
"""
import json
import os
import sqlite3
import sys
import tempfile
import threading
import urllib.request
import urllib.error

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


def call(method, path, body=None, token=None, origin=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if origin:
        req.add_header("Origin", origin)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode()), dict(r.headers)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode()), dict(e.headers)
        except Exception:
            return e.code, {}, dict(e.headers)


def reg(name):
    st, j, _ = call("POST", "/register", {"username": name, "password": "parola123",
                                          "email": f"{name}@b.com", "data": {}})
    return st, j.get("token")


def main():
    fails = []

    def check(cond, msg):
        print(("  ✓ " if cond else "  ✗ ") + msg)
        if not cond:
            fails.append(msg)

    # === Kurulum: A + B (2 register) ===
    _, tokA = reg("alice")
    _, tokB = reg("bob")
    check(bool(tokA and tokB), "iki kullanıcı kaydedildi (normal akış)")

    # === CORS ===
    _, _, h_allow = call("GET", "/health", origin="http://localhost:4200")
    check(h_allow.get("Access-Control-Allow-Origin") == "http://localhost:4200",
          "izinli köken ACAO ile yansıtıldı")
    _, _, h_evil = call("GET", "/health", origin="http://evil.example.com")
    check(h_evil.get("Access-Control-Allow-Origin") is None,
          "izinsiz köken ACAO ALMADI (engellendi)")

    # === Güvenlik başlıkları ===
    check(h_allow.get("X-Content-Type-Options") == "nosniff", "nosniff başlığı var")
    check(h_allow.get("X-Frame-Options") == "DENY", "X-Frame-Options DENY var")
    check("default-src 'none'" in (h_allow.get("Content-Security-Policy") or ""), "CSP var")

    # === Yasaklı kelime: kullanıcı adı ===
    st, j, _ = call("POST", "/register", {"username": "orospu123", "password": "parola123",
                                          "email": "x@b.com", "data": {}})
    check(st == 400 and j.get("error") == "banned_username", f"yasaklı kullanıcı adı reddedildi ({st})")

    # === Arkadaşlık kur (mesaj için) ===
    call("POST", "/friends/request", {"username": "bob"}, token=tokA)
    call("POST", "/friends/request", {"username": "alice"}, token=tokB)
    bid = call("GET", "/me", token=tokB)[1]["user"]["id"]

    # === Yasaklı kelime: sohbet ===
    st, j, _ = call("POST", "/messages", {"to": bid, "body": "seni gidi orospu"}, token=tokA)
    check(st == 400 and j.get("error") == "banned_word", f"yasaklı sohbet mesajı reddedildi ({st})")
    st, j, _ = call("POST", "/messages", {"to": bid, "body": "merhaba nasilsin"}, token=tokA)
    check(st == 200, f"temiz mesaj kabul edildi ({st}) — normal akış etkilenmedi")

    # === Şikayet (report) ===
    st, j, _ = call("POST", "/report", {"targetUsername": "bob", "reason": "spam",
                                        "detail": "reklam yolluyor", "context": "chat"}, token=tokA)
    check(st == 200, f"şikayet kabul edildi ({st})")
    st, j, _ = call("POST", "/report", {"targetUsername": "alice"}, token=tokA)
    check(st == 400 and j.get("error") == "cannot_report_self", "kendini şikayet reddedildi")
    st, j, _ = call("POST", "/report", {"targetUsername": "yokboyle"}, token=tokA)
    check(st == 404, "olmayan kullanıcı şikayeti 404")
    conn = sqlite3.connect(_tmp.name)
    n_reports = conn.execute("SELECT COUNT(*) FROM reports").fetchone()[0]
    conn.close()
    check(n_reports == 1, f"şikayet reports tablosuna kaydedildi ({n_reports})")

    # === Hız sınırı: mesaj (30/dk) ===
    statuses = [call("POST", "/messages", {"to": bid, "body": f"mesaj {i}"}, token=tokA)[0]
                for i in range(35)]
    check(statuses[0] == 200 and 429 in statuses, "mesaj hız sınırı aşılınca 429")

    # === Hız sınırı: arkadaş isteği (20/dk) ===
    fr = [call("POST", "/friends/request", {"username": f"nobody{i}"}, token=tokA)[0]
          for i in range(25)]
    check(429 in fr, "arkadaş isteği hız sınırı aşılınca 429")

    # === Hız sınırı: kullanıcı arama (30/dk) ===
    se = [call("GET", "/users/search?q=ali", token=tokA)[0] for _ in range(35)]
    check(se[0] == 200 and 429 in se, "kullanıcı arama hız sınırı aşılınca 429")

    # === Hız sınırı: oda kurma (10/dk) ===
    rc = [call("POST", "/rooms/create", {"duration": 60}, token=tokB)[0] for _ in range(14)]
    check(rc[0] == 200 and 429 in rc, "oda kurma hız sınırı aşılınca 429")

    # === Hata sızıntısı: bozuk istek iç detay sızdırmaz ===
    # tokB kullan: A'nın friend_req kovası flood'dan doldu (429 dönerdi); B'ninki boş.
    st, j, _ = call("POST", "/friends/request", {"id": "abc-not-int"}, token=tokB)
    body = json.dumps(j)
    check(st == 400 and "error" in j and "Traceback" not in body and "File \"" not in body,
          f"hata yanıtı iç detay sızdırmadı ({st} {j.get('error')})")

    # === Hız sınırı: kayıt (IP başına 8/10dk) — EN SON (IP bütçesini tüketir) ===
    # Şimdiye dek 3 kayıt denemesi yapıldı (alice, bob, orospu123). 5 daha OK, 9. → 429.
    reg_status = []
    for i in range(7):
        st, _, _ = call("POST", "/register", {"username": f"flood{i}", "password": "parola123",
                                              "email": f"f{i}@b.com", "data": {}})
        reg_status.append(st)
    check(429 in reg_status, f"kayıt hız sınırı aşılınca 429 ({reg_status})")

    print()
    if fails:
        print(f"BAŞARISIZ: {len(fails)} kontrol geçmedi")
        sys.exit(1)
    print("TÜM KONTROLLER GEÇTİ ✓ — backend sertleştirildi")


if __name__ == "__main__":
    try:
        main()
    finally:
        try:
            os.unlink(_tmp.name)
        except OSError:
            pass
