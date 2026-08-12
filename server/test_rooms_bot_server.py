"""
Sunucu botu — uçtan uca entegrasyon testi.

Botun artık SUNUCUDA koştuğunu doğrular:
  1. Yarış başlayınca botun skoru, HİÇBİR istemci girdisi olmadan (botprogress
     çağrısı YOK) sunucuda üretilir ve zamanla artar → "host tarayıcısı olmadan"
     çalışır (host sekmesi kapansa da devam eder mantığının özü).
  2. /rooms/botprogress uç noktası KALDIRILDI (artık 404).
  3. Oda başına bot sınırı (5) uygulanır.
  4. Bot skoru istemciden KABUL EDİLMEZ (botprogress yok; skor sunucudan).

Çalıştır:  python server/test_rooms_bot_server.py
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
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def reg(name):
    _, j = call("POST", "/register", {"username": name, "password": "parola123",
                                      "email": f"{name}@b.com", "data": {}})
    return j["token"]


def main():
    fails = []

    def check(cond, msg):
        print(("  ✓ " if cond else "  ✗ ") + msg)
        if not cond:
            fails.append(msg)

    host = reg("srvhost")
    # Oda: kısa süre (bot çizelgesi hızlı hesaplansın)
    st, j = call("POST", "/rooms/create", {"duration": 60}, token=host)
    code = j["room"]["code"]

    # Bot limiti: 5 bot eklenir (hızlı seviyeler), 6.'sı reddedilir.
    for i in range(5):
        lvl = ["easy", "medium", "hard", "easy", "medium"][i]
        st, j = call("POST", "/rooms/addbot", {"code": code, "difficulty": lvl}, token=host)
        check(st == 200, f"{i+1}. bot ({lvl}) eklendi")
    st, j = call("POST", "/rooms/addbot", {"code": code, "difficulty": "easy"}, token=host)
    check(st == 409 and j.get("error") == "too_many_bots",
          f"6. bot reddedildi (limit) — gelen {st} {j.get('error')}")

    # Yarışı başlat
    st, j = call("POST", "/rooms/start", {"code": code}, token=host)
    check(st == 200, "yarış başladı")

    # Bot çizelgeleri arka planda hesaplanır; skorun süreyle ÜRETİLDİĞİni gör.
    # HİÇBİR botprogress çağrısı yapmıyoruz → skor tamamen sunucudan.
    def bot_scores():
        st, j = call("GET", f"/rooms/state?code={code}", token=host)
        return [p for p in j["room"]["players"] if p["isBot"]]

    time.sleep(2.5)
    bots1 = bot_scores()
    total1 = sum(p["score"] for p in bots1)
    check(total1 > 0, f"botlar sunucuda skor üretti (istemci girdisi YOK) — toplam {total1}")

    time.sleep(2.0)
    bots2 = bot_scores()
    total2 = sum(p["score"] for p in bots2)
    check(total2 >= total1, f"bot skoru zamanla artıyor/sabit ({total1} → {total2})")
    check(all(isinstance(p["score"], int) and p["score"] >= 0 for p in bots2),
          "tüm bot skorları geçerli (sunucu üretimi)")

    # /rooms/botprogress KALDIRILDI → 404
    st, j = call("POST", "/rooms/botprogress",
                 {"code": code, "botId": -1, "score": 999999, "best": 8192, "done": False},
                 token=host)
    check(st == 404, f"/rooms/botprogress kaldırıldı (gelen {st})")

    # botprogress 404'ten SONRA da bot skoru sunucudan gelmeye devam ediyor
    # (yani sahte skor kabul edilmedi; skor hâlâ çizelgeden).
    bots3 = bot_scores()
    check(all(p["score"] < 900000 for p in bots3),
          "sahte istemci skoru yok sayıldı (skor hâlâ sunucudan)")

    print()
    if fails:
        print(f"BAŞARISIZ: {len(fails)} kontrol geçmedi")
        sys.exit(1)
    print("TÜM KONTROLLER GEÇTİ ✓ — bot sunucuda koşuyor, skor manipüle edilemez")


if __name__ == "__main__":
    try:
        main()
    finally:
        try:
            os.unlink(_tmp.name)
        except OSError:
            pass
