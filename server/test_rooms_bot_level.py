"""
Bot zorluğu VERİ olarak taşınıyor mu — entegrasyon testi.

Gerçek sunucuyu geçici bir DB ile ayağa kaldırır ve şunları doğrular:
  1. /rooms/addbot her geçerli kademeyi kabul eder ve seviyeyi room_players'a
     'level' alanı olarak KAYDEDER.
  2. /rooms/state (ve addbot yanıtı) her botun 'level' alanını döndürür — bu,
     istemcinin zorluğu görünen addan çözmesine gerek bırakmaz.
  3. Geçersiz zorluk REDDEDİLİR (400 invalid_level).
  4. İnsan oyuncunun 'level' alanı null'dur (yalnızca botlarda dolu).

Çalıştır:  python server/test_rooms_bot_level.py
"""
import json
import os
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
        return e.code, json.loads(e.read().decode())


def main():
    fails = []

    def check(cond, msg):
        if not cond:
            fails.append(msg)
            print("  ✗ " + msg)
        else:
            print("  ✓ " + msg)

    # Host kaydı + oda
    _, j = call("POST", "/register", {
        "username": "hostu", "password": "parola123", "email": "h@b.com", "data": {},
    })
    token = j["token"]
    st, j = call("POST", "/rooms/create", {"duration": 120}, token=token)
    check(st == 200, "oda oluşturuldu")
    code = j["room"]["code"]

    # Her kademede bot ekle; botId -> beklenen seviye eşlemesini biriktir
    expected = {}
    last_room = None
    for lvl in ["easy", "medium", "hard", "expert"]:
        st, j = call("POST", "/rooms/addbot", {"code": code, "difficulty": lvl}, token=token)
        check(st == 200, f"'{lvl}' botu eklendi (200)")
        check(j.get("botId", 0) < 0, f"'{lvl}' botu negatif kimlikli")
        expected[j["botId"]] = lvl
        last_room = j["room"]

    # addbot yanıtındaki oda durumunda her botun 'level' alanı DOĞRU
    by_id = {p["id"]: p for p in last_room["players"]}
    for bot_id, lvl in expected.items():
        p = by_id.get(bot_id)
        check(p is not None, f"bot {bot_id} oda durumunda var")
        check(p and p.get("level") == lvl,
              f"bot {bot_id} level='{lvl}' veri olarak dönüyor (gelen: {p and p.get('level')})")
        check(p and p.get("isBot") is True, f"bot {bot_id} isBot=true")

    # /rooms/state de aynı seviyeleri taşır (kalıcı → veriden okunuyor)
    st, j = call("GET", f"/rooms/state?code={code}", token=token)
    check(st == 200, "/rooms/state 200")
    levels = sorted(p["level"] for p in j["room"]["players"] if p["isBot"])
    check(levels == ["easy", "expert", "hard", "medium"],
          f"state tüm bot seviyelerini taşıyor (gelen: {levels})")

    # İnsan oyuncunun (host) level alanı null
    host = next((p for p in j["room"]["players"] if not p["isBot"]), None)
    check(host is not None and host.get("level") is None, "insan oyuncunun level'i null")

    # Geçersiz zorluk reddedilir
    st, j = call("POST", "/rooms/addbot", {"code": code, "difficulty": "impossible"}, token=token)
    check(st == 400 and j.get("error") == "invalid_level",
          f"geçersiz zorluk reddedildi (gelen: {st} {j.get('error')})")

    print()
    if fails:
        print(f"BAŞARISIZ: {len(fails)} kontrol geçmedi")
        sys.exit(1)
    print("TÜM KONTROLLER GEÇTİ ✓")


if __name__ == "__main__":
    try:
        main()
    finally:
        try:
            os.unlink(_tmp.name)
        except OSError:
            pass
