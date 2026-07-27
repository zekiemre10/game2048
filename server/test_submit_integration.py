"""
Skor doğrulama — uçtan uca entegrasyon testi.

Gerçek sunucuyu geçici bir DB ile ayağa kaldırır ve şunları doğrular:
  1. Uydurma skor (transkriptsiz / bozuk hamle) REDDEDİLİR.
  2. Meşru transkript KABUL edilir; sıralamaya SUNUCUNUN hesapladığı skor yazılır.
  3. Reddedilen gönderim flagged_submissions'a kaydedilir.
  4. Skor gönderim hız sınırı çalışır.

Çalıştır:  python server/test_submit_integration.py
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
        return e.code, json.loads(e.read().decode())


def main():
    fails = []

    # Kayıt
    _, j = call("POST", "/register", {
        "username": "hileci1", "password": "parola123",
        "email": "a@b.com", "data": {},
    })
    token = j["token"]

    # Meşru bir transkript: fixture'lardan 4×4 bir oyun al
    with open(os.path.join(HERE, "replay_fixtures.json"), encoding="utf-8") as f:
        fixtures = json.load(f)
    real = next(x for x in fixtures if x["size"] == 4 and x["score"] > 500)

    # --- 1) UYDURMA SKOR: transkriptsiz, sadece dev skor iddiası ---
    st, j = call("POST", "/monthly/submit",
                 {"score": 9_999_999}, token)
    ok1 = st == 400 and j.get("error") == "invalid_score"
    print(f"1) Uydurma skor (transkriptsiz) reddedildi: "
          f"{'EVET OK' if ok1 else f'HAYIR X ({st} {j})'}")
    if not ok1:
        fails.append("fake_no_transcript")

    # --- 1b) BOZUK TRANSKRIPT: gerçek tohum, ama sahte devasa skor + bozuk hamle ---
    st, j = call("POST", "/monthly/submit",
                 {"seed": real["seed"], "moves": "UDLRX" * 10,
                  "size": 4, "score": 9_999_999}, token)
    ok1b = st == 400
    print(f"1b) Bozuk hamle dizisi reddedildi: "
          f"{'EVET OK' if ok1b else f'HAYIR X ({st} {j})'}")
    if not ok1b:
        fails.append("fake_bad_moves")

    # --- 2) MEŞRU TRANSKRIPT: sunucu skoru KENDİ hesaplar ---
    st, j = call("POST", "/monthly/submit",
                 {"seed": real["seed"], "moves": real["moves"],
                  "size": 4, "score": 1},  # istemci 1 dese bile sunucu gerçeği bulur
                 token)
    ok2 = st == 200 and j.get("score") == real["score"]
    print(f"2) Meşru oyun kabul, sunucu skoru = {j.get('score')} "
          f"(beklenen {real['score']}): {'EVET OK' if ok2 else 'HAYIR X'}")
    if not ok2:
        fails.append("legit_rejected")

    # --- 3) Skor tablosunda SUNUCU skoru görünüyor ---
    st, j = call("GET", "/leaderboard?scope=monthly", None, token)
    top = j.get("top", [])
    ok3 = top and top[0]["bestScore"] == real["score"]
    print(f"3) Skor tablosunda sunucu skoru: "
          f"{top[0]['bestScore'] if top else '(bos)'} "
          f"{'EVET OK' if ok3 else 'HAYIR X'}")
    if not ok3:
        fails.append("leaderboard_wrong")

    # --- 4) Reddedilen gönderimler kaydedildi mi? ---
    conn = app.db()
    n = conn.execute("SELECT COUNT(*) FROM flagged_submissions").fetchone()[0]
    conn.close()
    ok4 = n >= 2
    print(f"4) Şüpheli gönderim kaydı: {n} kayıt "
          f"{'EVET OK' if ok4 else 'HAYIR X'}")
    if not ok4:
        fails.append("no_flag_log")

    # --- 5) Hız sınırı ---
    limited = False
    for _ in range(30):
        st, _ = call("POST", "/monthly/submit",
                     {"seed": real["seed"], "moves": real["moves"], "size": 4}, token)
        if st == 429:
            limited = True
            break
    print(f"5) Hız sınırı devreye girdi (429): "
          f"{'EVET OK' if limited else 'HAYIR X'}")
    if not limited:
        fails.append("no_rate_limit")

    print()
    if fails:
        print("[X] BASARISIZ:", ", ".join(fails))
        sys.exit(1)
    print("[OK] TUM DOGRULAMALAR GECTI - skor tablosu hile yapilamaz")


if __name__ == "__main__":
    try:
        main()
    finally:
        _srv.shutdown()
        try:
            os.unlink(_tmp.name)
        except OSError:
            pass
