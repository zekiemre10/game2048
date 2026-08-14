"""
Bot KARAKTERİ VERİ olarak taşınıyor mu — entegrasyon testi.

Gerçek sunucuyu geçici bir DB ile ayağa kaldırır ve şunları doğrular:
  1. /rooms/addbot her geçerli karakteri kabul eder ve KARAKTER kimliğini
     room_players.level sütununda saklar; state 'character' alanı olarak döner.
  2. Karakter botunda 'character' dolu, 'level' null; eski zorluk botunda tersi.
  3. Geçersiz karakter REDDEDİLİR (400 invalid_character).
  4. Karakter botu için sunucu skor çizelgesi (yarış başlayınca) resolve_cfg ile
     üretilir — karakter ilerledikçe skor > 0 olur (motor karakteri tanıyor).

Çalıştır:  python server/test_rooms_bot_character.py
"""
import json
import os
import sys
import tempfile
import threading
import time
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
        print(("  ✓ " if cond else "  ✗ ") + msg)
        if not cond:
            fails.append(msg)

    _, j = call("POST", "/register", {
        "username": "hostu", "password": "parola123", "email": "h@b.com", "data": {},
    })
    token = j["token"]
    st, j = call("POST", "/rooms/create", {"duration": 120}, token=token)
    check(st == 200, "oda oluşturuldu")
    code = j["room"]["code"]

    # Her karakterde bot ekle
    expected = {}
    last_room = None
    for ch in ["corner", "space", "hasty", "balanced"]:
        st, j = call("POST", "/rooms/addbot", {"code": code, "character": ch}, token=token)
        check(st == 200, f"'{ch}' karakteri eklendi (200)")
        check(j.get("botId", 0) < 0, f"'{ch}' botu negatif kimlikli")
        expected[j["botId"]] = ch
        last_room = j["room"]

    # Oda durumunda her botun 'character' alanı DOĞRU, 'level' null
    by_id = {p["id"]: p for p in last_room["players"]}
    for bot_id, ch in expected.items():
        p = by_id.get(bot_id)
        check(p is not None, f"bot {bot_id} oda durumunda var")
        check(p and p.get("character") == ch,
              f"bot {bot_id} character='{ch}' veri olarak dönüyor (gelen: {p and p.get('character')})")
        check(p and p.get("level") is None,
              f"karakter botunun 'level' alanı null (gelen: {p and p.get('level')})")
        check(p and p.get("isBot") is True, f"bot {bot_id} isBot=true")

    # /rooms/state de aynı karakterleri taşır
    st, j = call("GET", f"/rooms/state?code={code}", token=token)
    chars = sorted(p["character"] for p in j["room"]["players"] if p["isBot"])
    check(chars == ["balanced", "corner", "hasty", "space"],
          f"state tüm karakterleri taşıyor (gelen: {chars})")

    # İnsan oyuncunun character + level'i null
    host = next((p for p in j["room"]["players"] if not p["isBot"]), None)
    check(host and host.get("character") is None and host.get("level") is None,
          "insan oyuncunun character + level'i null")

    # Geçersiz karakter reddedilir
    st, j = call("POST", "/rooms/addbot", {"code": code, "character": "godmode"}, token=token)
    check(st == 400 and j.get("error") == "invalid_character",
          f"geçersiz karakter reddedildi (gelen: {st} {j.get('error')})")

    # Eski zorluk yolu HÂLÂ çalışıyor (geriye dönük): difficulty=hard
    st, j = call("POST", "/rooms/addbot", {"code": code, "difficulty": "hard"}, token=token)
    if st == 200:
        p = next((x for x in j["room"]["players"] if x["id"] == j["botId"]), None)
        check(p and p.get("level") == "hard" and p.get("character") is None,
              "eski zorluk botu level='hard', character=null (geriye dönük)")
    else:
        check(j.get("error") == "too_many_bots", "5 bot sınırı (geriye dönük yol denendi)")

    # Karakter botu için yarış skoru sunucuda üretiliyor mu? (start → kısa bekle)
    st, j = call("POST", "/rooms/start", {"code": code}, token=token)
    check(st == 200, "yarış başladı")
    time.sleep(1.5)  # sunucu bot çizelgesini arka planda hesaplasın
    st, j = call("GET", f"/rooms/state?code={code}", token=token)
    bot_scores = [p["score"] for p in j["room"]["players"] if p["isBot"]]
    check(any(s > 0 for s in bot_scores),
          f"karakter botları yarışta skor üretti (gelen: {bot_scores})")

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
