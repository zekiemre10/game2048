"""
Ekonomi ayarları — entegrasyon testi.

Doğrular:
  1. GET /settings PUBLIC (auth'suz) + gömülü varsayılanları döner.
  2. YETKİ: normal kullanıcı /admin/settings* uçlarına 403.
  3. Geçerli değişiklik /settings + /admin/settings'e yansır.
  4. Aralık dışı / tip hatası REDDEDİLİR (400) — sunucu tarafı.
  5. Ay-kilidi: bu ay skor varken champion_prize_gold değişmez (409); ay boşken olur.
  6. Geri alma: değişiklik geri alınır (önceki değere / varsayılana döner).
  7. Değişiklik geçmişe yazılır.
  8. champion_prize(conn) ayardaki altını yansıtır.
  9. Oyuncunun mevcut altını ayar değişiminden ETKİLENMEZ.
 10. Tüm eylemler denetime yazılır.

Çalıştır:  python server/test_economy.py
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

    tu, U = register("player")
    ta, A = register("econadmin")
    promote_admin("econadmin")

    # --- 1) PUBLIC /settings ---
    st, j = call("GET", "/settings")  # auth yok
    s = j.get("settings", {})
    check("GET /settings public + varsayılanlar", st == 200 and s.get("power_price.bomb") == 40
          and s.get("level_reward_mult") == 1.0, f"{st} {s}")

    # --- 2) YETKİ ---
    st, _ = call("GET", "/admin/settings", token=tu)
    check("normal kullanıcı /admin/settings 403", st == 403, str(st))
    st, _ = call("POST", "/admin/settings", {"key": "power_price.bomb", "value": 50}, tu)
    check("normal kullanıcı ayar değiştiremez 403", st == 403, str(st))

    # --- 3) Geçerli değişiklik yansır ---
    st, j = call("POST", "/admin/settings", {"key": "power_price.bomb", "value": 60}, ta)
    check("geçerli değişiklik 200", st == 200 and j.get("value") == 60, f"{st} {j}")
    st, j = call("GET", "/settings")
    check("değişiklik /settings'e yansır (bomb=60)", j["settings"]["power_price.bomb"] == 60, str(j["settings"]))
    st, j = call("GET", "/admin/settings", token=ta)
    bomb = next(r for r in j["settings"] if r["key"] == "power_price.bomb")
    check("admin ekranı mevcut+varsayılan+aralık gösterir",
          bomb["current"] == 60 and bomb["default"] == 40 and bomb["min"] == 1 and bomb["max"] == 500,
          str(bomb))

    # --- 4) Aralık dışı / tip REDDEDİLİR ---
    st, j = call("POST", "/admin/settings", {"key": "power_price.bomb", "value": 0}, ta)
    check("fiyat 0 reddedilir (400 out_of_range)", st == 400 and j.get("error") == "out_of_range", f"{st} {j}")
    st, j = call("POST", "/admin/settings", {"key": "champion_prize_gold", "value": 999999}, ta)
    check("ödül 999999 reddedilir", st == 400 and j.get("error") == "out_of_range", f"{st} {j}")
    st, j = call("POST", "/admin/settings", {"key": "power_price.bomb", "value": "x"}, ta)
    check("metin reddedilir (bad_type)", st == 400 and j.get("error") == "bad_type", f"{st} {j}")
    st, j = call("POST", "/admin/settings", {"key": "nope", "value": 1}, ta)
    check("bilinmeyen anahtar reddedilir", st == 400 and j.get("error") == "unknown_key", f"{st} {j}")

    # --- 5) Ay-kilidi (champion) ---
    month = app.utc_month()
    conn = app.db()
    conn.execute("INSERT OR REPLACE INTO monthly_scores (month,user_id,username,score,best,updated) "
                 "VALUES (?,?,?,?,?,?)", (month, U, "player", 5000, 256, 1))
    conn.commit(); conn.close()
    st, j = call("POST", "/admin/settings", {"key": "champion_prize_gold", "value": 3000}, ta)
    check("yarış başladıysa champion ödülü değişmez (409)",
          st == 409 and j.get("error") == "champion_locked_midmonth", f"{st} {j}")
    # ay boşken izin verilir
    conn = app.db(); conn.execute("DELETE FROM monthly_scores WHERE month=?", (month,)); conn.commit(); conn.close()
    st, j = call("POST", "/admin/settings", {"key": "champion_prize_gold", "value": 3000}, ta)
    check("ay boşken champion ödülü değişir (200)", st == 200 and j.get("value") == 3000, f"{st} {j}")

    # --- 8) champion_prize(conn) ayardan gelir ---
    conn = app.db()
    cp = app.champion_prize(conn)
    conn.close()
    check("champion_prize altını ayardan (3000)", cp["gold"] == 3000 and cp["powers"]["bomb"] == 3, str(cp))

    # --- 6) Geri alma ---
    st, j = call("POST", "/admin/settings/undo", {"key": "power_price.bomb"}, ta)
    check("bomb geri alınır → önceki 40 (varsayılan)", st == 200 and j.get("value") == 40, f"{st} {j}")
    st, j = call("GET", "/settings")
    check("geri alma /settings'e yansır", j["settings"]["power_price.bomb"] == 40, str(j["settings"]["power_price.bomb"]))
    st, j = call("POST", "/admin/settings/undo", {"key": "level_reward_mult"}, ta)
    check("geçmişi olmayan geri alma 404", st == 404 and j.get("error") == "no_history", f"{st} {j}")

    # --- 7) Geçmiş ---
    st, j = call("GET", "/admin/settings", token=ta)
    check("değişiklik geçmişi kaydediliyor", len(j.get("history", [])) >= 3, str(len(j.get("history", []))))

    # --- 9) Oyuncu altını etkilenmez ---
    conn = app.db()
    conn.execute("UPDATE users SET data=? WHERE id=?", (json.dumps({"gold": 1234, "bestScore": 999}), U))
    conn.commit(); conn.close()
    call("POST", "/admin/settings", {"key": "power_price.hint", "value": 99}, ta)
    conn = app.db()
    row = conn.execute("SELECT data FROM users WHERE id=?", (U,)).fetchone()
    conn.close()
    check("ayar değişimi oyuncu altınını bozmaz", json.loads(row["data"])["gold"] == 1234,
          str(row["data"]))

    # --- 10) Denetim ---
    conn = app.db()
    acts = [r["action"] for r in conn.execute("SELECT action FROM admin_audit")]
    conn.close()
    check("ayar değişimi denetimde", "setting_change" in acts, str(set(acts)))
    check("geri alma denetimde", "setting_undo" in acts, str(set(acts)))

    print()
    if fails:
        print(f"BAŞARISIZ: {len(fails)} -> {fails}")
        sys.exit(1)
    print("TÜM KONTROLLER GEÇTİ ✓ — ekonomi ayarları")


if __name__ == "__main__":
    try:
        main()
    finally:
        try:
            os.unlink(_tmp.name)
        except OSError:
            pass
