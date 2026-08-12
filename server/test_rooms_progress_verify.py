"""
Oda skoru SUNUCU DOĞRULAMASI — entegrasyon testi (OYUN-225 devamı).

/rooms/progress artık istemcinin skorunu KABUL ETMEZ; gönderilen hamle
transkriptini odanın tohumuyla yeniden oynatıp skoru SUNUCU hesaplar. Doğrular:
  1. Ham skor alanı (transkriptsiz) reddedilir → konsoldan skor şişirilemez.
  2. Bozuk/sahte transkript reddedilir ve flagged_submissions'a yazılır.
  3. Meşru transkript kabul edilir; skor SUNUCUNUN replay'iyle birebir.
  4. Transkript büyüdükçe skor artar (monoton); canlı sıralama çalışır.

Çalıştır:  python server/test_rooms_progress_verify.py
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
from bot_ai import play_bot_game  # geçerli transkript üretmek için  # noqa: E402
from replay import replay_game  # noqa: E402
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


def flagged_count(reason=None):
    conn = sqlite3.connect(_tmp.name)
    try:
        if reason:
            n = conn.execute("SELECT COUNT(*) FROM flagged_submissions WHERE endpoint='room' AND reason=?",
                             (reason,)).fetchone()[0]
        else:
            n = conn.execute("SELECT COUNT(*) FROM flagged_submissions WHERE endpoint='room'").fetchone()[0]
        return n
    finally:
        conn.close()


def my_score(state, token_name):
    for p in state["players"]:
        if p["username"] == token_name:
            return p["score"]
    return None


def main():
    fails = []

    def check(cond, msg):
        print(("  ✓ " if cond else "  ✗ ") + msg)
        if not cond:
            fails.append(msg)

    host = reg("verhost")
    peer_tok = reg("verpeer")
    st, j = call("POST", "/rooms/create", {"duration": 120}, token=host)
    code = j["room"]["code"]
    call("POST", "/rooms/join", {"code": code}, token=peer_tok)
    call("POST", "/rooms/start", {"code": code}, token=host)

    # Oda tohumunu al
    st, j = call("GET", f"/rooms/state?code={code}", token=host)
    seed = j["room"]["seed"]

    # Bu tohum için GEÇERLİ bir transkript üret (bot geçerli hamleler oynar)
    g_short = play_bot_game(seed, "easy", 25)
    g_long = play_bot_game(seed, "easy", 60)
    server_short = replay_game(seed, g_short["moves"], 4)["score"]
    server_long = replay_game(seed, g_long["moves"], 4)["score"]

    # (1) Ham skor (transkriptsiz) reddedilir → skor şişirilemez
    st, j = call("POST", "/rooms/progress", {"code": code, "score": 999999, "best": 8192}, token=peer_tok)
    check(st == 400 and j.get("error") == "invalid_transcript",
          f"ham skor (transkriptsiz) reddedildi — gelen {st} {j.get('error')}")

    # (2) Bozuk/sahte transkript reddedilir + flag
    before = flagged_count()
    st, j = call("POST", "/rooms/progress", {"code": code, "moves": "QQQQZZZZ"}, token=peer_tok)
    check(st == 200, "bozuk transkript isteği 200 döndü (sıralama bozulmadı)")
    check(my_score(j["room"], "verpeer") == 0, "bozuk transkriptte skor GÜNCELLENMEDİ (0)")
    check(flagged_count("invalid_replay") == before + 1, "bozuk transkript flagged_submissions'a yazıldı")

    # (3) Meşru transkript kabul; skor = SUNUCUNUN replay'i
    st, j = call("POST", "/rooms/progress", {"code": code, "moves": g_short["moves"]}, token=peer_tok)
    sc = my_score(j["room"], "verpeer")
    check(st == 200 and sc == server_short,
          f"meşru transkript kabul; skor sunucu-hesaplı ({sc} == {server_short})")

    # (4) Uzayan transkript → skor artar (monoton), canlı sıralama çalışır
    st, j = call("POST", "/rooms/progress", {"code": code, "moves": g_long["moves"], "done": True}, token=peer_tok)
    sc2 = my_score(j["room"], "verpeer")
    check(sc2 == server_long and sc2 >= sc, f"skor arttı/monoton ({sc} → {sc2})")
    # Sıra dışı ESKİ (kısa) transkript skoru GERİLETMEZ (MAX)
    st, j = call("POST", "/rooms/progress", {"code": code, "moves": g_short["moves"]}, token=peer_tok)
    check(my_score(j["room"], "verpeer") == sc2, "eski/kısa transkript skoru geriletmedi (MAX)")

    # Canlı sıralama: oyuncular skora göre sıralı geliyor
    st, j = call("GET", f"/rooms/state?code={code}", token=host)
    scores = [p["score"] for p in j["room"]["players"]]
    check(scores == sorted(scores, reverse=True), "canlı sıralama skora göre azalan")

    print()
    if fails:
        print(f"BAŞARISIZ: {len(fails)} kontrol geçmedi")
        sys.exit(1)
    print("TÜM KONTROLLER GEÇTİ ✓ — oda skorları sunucuda doğrulanıyor")


if __name__ == "__main__":
    try:
        main()
    finally:
        try:
            os.unlink(_tmp.name)
        except OSError:
            pass
