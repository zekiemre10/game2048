"""
Bulut senkronu ALAN BAZLI BİRLEŞTİRME — entegrasyon testi.

Eskiden /sync gelen bloğu körü körüne yazıyordu (son-yazan-kazanır) → iki cihazda
paralel oynanan ilerleme sessizce siliniyordu. Artık sunucu alan alan birleştirir.
Doğrular:
  1. İki cihaz senaryosu: telefon+PC paralel ilerlemesi birleşir, hiçbiri silinmez.
  2. Rekorlar her zaman en yükseği korur (MAX).
  3. Açılmış başarımlar hiçbir senaryoda kapanmaz (BİRLEŞİM).
  4. Altın kaybolmaz/çoğalmaz (kazanılan/harcanan ayrı ayrı MAX).
  5. Tercihler (ad/avatar) en son değişen kazanır (prefsAt LWW).
  6. Mevcut (sürümsüz/legacy) hesap verisi göçte bozulmaz.

Çalıştır:  python server/test_sync_merge.py
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


def reg(name, data=None):
    _, j = call("POST", "/register", {"username": name, "password": "parola123",
                                      "email": f"{name}@b.com", "data": data or {}})
    return j["token"]


def sync(token, data):
    st, j = call("POST", "/sync", {"data": data}, token=token)
    return st, j.get("data")


def main():
    fails = []

    def check(cond, msg):
        print(("  ✓ " if cond else "  ✗ ") + msg)
        if not cond:
            fails.append(msg)

    # === İki cihaz senaryosu ===
    tok = reg("mergeuser")
    # Telefon: 1000 altın kazandı, bestScore 500, başarım 'a', ad 'Phone'
    phone = {"v": 2, "updatedAt": 100, "prefsAt": 100, "gold": 1000, "totalGoldEarned": 1000,
             "bestScore": 500, "bestTile": 2048, "achievements": ["ach_a"], "name": "Phone"}
    # PC: 200 altın HARCADI (earned 500, gold 300), bestScore 300, başarım 'b', ad 'PC' (daha yeni)
    pc = {"v": 2, "updatedAt": 200, "prefsAt": 200, "gold": 300, "totalGoldEarned": 500,
          "bestScore": 300, "bestTile": 1024, "achievements": ["ach_b"], "name": "PC"}

    _, m1 = sync(tok, phone)
    _, m2 = sync(tok, pc)

    check(sorted(m2["achievements"]) == ["ach_a", "ach_b"],
          f"başarımlar BİRLEŞTİ (ikisi de açık) — {m2['achievements']}")
    check(m2["bestScore"] == 500, f"rekor en yükseği korudu (500) — {m2['bestScore']}")
    check(m2["bestTile"] == 2048, f"en büyük kare en yükseği korudu (2048) — {m2['bestTile']}")
    # Altın: earned=max(1000,500)=1000, spent=max(0,200)=200 → gold=800
    check(m2["totalGoldEarned"] == 1000, f"kazanılan altın korundu (1000) — {m2['totalGoldEarned']}")
    check(m2["gold"] == 800,
          f"altın bakiyesi doğru: telefon kazancı + PC harcaması korundu (800) — {m2['gold']}")
    check(m2["name"] == "PC", f"tercih (ad) en son değişen kazandı (PC) — {m2['name']}")

    # Ters yön: telefon eski verisini TEKRAR gönderse bile hiçbir şey kaybolmaz
    _, m3 = sync(tok, phone)
    check(sorted(m3["achievements"]) == ["ach_a", "ach_b"] and m3["gold"] == 800 and m3["bestScore"] == 500,
          "eski cihaz tekrar yazsa da birleşmiş durum korunuyor (sessiz kayıp yok)")

    # === Tercih LWW: daha ESKİ prefsAt kazanamaz ===
    _, m4 = sync(tok, {"v": 2, "prefsAt": 50, "name": "Eski"})
    check(m4["name"] == "PC", f"daha eski prefsAt tercihi ezemedi (PC kaldı) — {m4['name']}")
    _, m5 = sync(tok, {"v": 2, "prefsAt": 999, "name": "Yeni"})
    check(m5["name"] == "Yeni", f"daha yeni prefsAt tercihi kazandı (Yeni) — {m5['name']}")

    # === Rekor asla düşmez ===
    _, r1 = sync(tok, {"v": 2, "bestScore": 50})
    check(r1["bestScore"] == 500, f"düşük bestScore rekoru düşürmedi (500) — {r1['bestScore']}")

    # === Göç (legacy/sürümsüz veri bozulmasın) ===
    tok2 = reg("legacyuser")
    # DB'ye doğrudan ESKİ formatta (v yok, prefsAt yok) blob yaz
    conn = sqlite3.connect(_tmp.name)
    legacy = {"gold": 500, "totalGoldEarned": 700, "bestScore": 1234, "bestLevel": 7,
              "achievements": ["old_ach"], "name": "Legacy", "gamesPlayed": 42}
    conn.execute("UPDATE users SET data=? WHERE username_lower='legacyuser'", (json.dumps(legacy),))
    conn.commit()
    conn.close()
    # Yeni sürümlü, DÜŞÜK değerli bir sync gelsin
    _, mg = sync(tok2, {"v": 2, "updatedAt": 5, "bestScore": 100, "achievements": ["new_ach"],
                        "gold": 0, "totalGoldEarned": 0})
    check(mg["bestScore"] == 1234, f"legacy rekor korundu (1234) — {mg['bestScore']}")
    check(mg["bestLevel"] == 7, f"legacy seviye korundu (7) — {mg['bestLevel']}")
    check(mg["gamesPlayed"] == 42, f"legacy istatistik korundu (42) — {mg['gamesPlayed']}")
    check(sorted(mg["achievements"]) == ["new_ach", "old_ach"], f"legacy+yeni başarım birleşti — {mg['achievements']}")
    # Altın: earned=max(700,0)=700, spent_legacy=700-500=200 → gold=500 (korundu, çoğalmadı)
    check(mg["totalGoldEarned"] == 700 and mg["gold"] == 500,
          f"legacy altın korundu, çoğalmadı (earned 700, gold 500) — {mg['totalGoldEarned']}/{mg['gold']}")

    print()
    if fails:
        print(f"BAŞARISIZ: {len(fails)} kontrol geçmedi")
        sys.exit(1)
    print("TÜM KONTROLLER GEÇTİ ✓ — bulut senkronu alan bazlı birleşiyor, sessiz kayıp yok")


if __name__ == "__main__":
    try:
        main()
    finally:
        try:
            os.unlink(_tmp.name)
        except OSError:
            pass
