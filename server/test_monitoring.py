"""
Canlı oda + sunucu izleme — entegrasyon testi.

Doğrular:
  1. YETKİ: normal kullanıcı tüm /admin izleme uçlarına 403.
  2. ODA LİSTESİ: odalar oyuncu/bot sayısı + durumla döner; oyuncu ADI dönmez.
  3. TAKILMIŞ TESPİTİ: süresi çoktan geçmiş 'racing' oda stuck=true.
  4. KAPATMA: gerekçe zorunlu; kapatınca status=finished + admin_closed;
     room_state adminClosed=true; delete=true odayı tamamen siler.
  5. DURUM: uptime, DB+WAL boyutu, oda sayıları, bot sağlığı, son hatalar döner.
  6. BAKIM: cleanup_rooms bitmiş/eski + yetim satırları siler; vacuum çalışır;
     backup dosya üretir. Hepsi denetime yazılır.
  7. ZAMANLANMIŞ: bakım fonksiyonları (monitor.cleanup_rooms/backup) çağrılabilir
     ve çalışır (daemon bunları koşar).
  8. is_stuck saf mantığı doğru.

Çalıştır:  python server/test_monitoring.py
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
import monitor  # noqa: E402
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


def seed_room(code, status, started_at, created, duration=180):
    conn = app.db()
    conn.execute(
        "INSERT OR REPLACE INTO rooms (code, host_id, status, seed, duration, started_at, created, admin_closed) "
        "VALUES (?,?,?,?,?,?,?,0)", (code, 1, status, 12345, duration, started_at, created))
    conn.commit()
    conn.close()


def add_player(code, uid, uname, level=None):
    conn = app.db()
    conn.execute(
        "INSERT OR REPLACE INTO room_players (code, user_id, username, level, score, best, done, joined) "
        "VALUES (?,?,?,?,0,0,0,?)", (code, uid, uname, level, int(time.time())))
    conn.commit()
    conn.close()


def main():
    fails = []

    def check(name, cond, detail=""):
        print(f"{'OK ' if cond else 'X  '} {name}{'' if cond else '  -> ' + detail}")
        if not cond:
            fails.append(name)

    tu, U = register("player")
    tm, M = register("monadmin")
    promote_admin("monadmin")

    now = int(time.time())
    seed_room("AAAA", "racing", now - 1000, now - 1010)   # süresi çoktan geçti → stuck
    add_player("AAAA", U, "zephyrhuman")                   # ayırt edici ad (sızıntı kontrolü)
    add_player("AAAA", -1, "🤖 Bot", level="medium")       # bot
    seed_room("BBBB", "lobby", None, now - 30)             # taze lobby → değil
    seed_room("CCCC", "finished", now - 5000, now - 5200)  # bitmiş

    # --- 8) is_stuck saf ---
    check("is_stuck: süresi geçmiş racing → true",
          monitor.is_stuck("racing", now - 1000, 180, now - 1010, now) is True)
    check("is_stuck: taze lobby → false",
          monitor.is_stuck("lobby", None, 180, now - 30, now) is False)

    # --- 1) YETKİ ---
    for path in ("/admin/rooms", "/admin/status"):
        st, _ = call("GET", path, token=tu)
        check(f"normal kullanıcı {path} 403", st == 403, str(st))

    # --- 2) ODA LİSTESİ ---
    st, j = call("GET", "/admin/rooms", token=tm)
    rooms = {r["code"]: r for r in j.get("rooms", [])}
    check("oda listesi 3 oda döner", st == 200 and len(rooms) >= 3, str(list(rooms)))
    check("AAAA oyuncu=1 bot=1", rooms.get("AAAA", {}).get("players") == 1
          and rooms.get("AAAA", {}).get("bots") == 1, str(rooms.get("AAAA")))
    check("oda listesi oyuncu ADI içermez", "zephyrhuman" not in json.dumps(j), "ad sızdı")

    # --- 3) TAKILMIŞ ---
    check("AAAA takılmış işaretli", rooms.get("AAAA", {}).get("stuck") is True, str(rooms.get("AAAA")))
    check("stuck sayısı >= 1", j.get("stuck", 0) >= 1, str(j.get("stuck")))

    # --- 4) KAPATMA ---
    st, j = call("POST", "/admin/rooms/close", {"code": "BBBB"}, tm)
    check("gerekçesiz kapatma 400", st == 400 and j.get("error") == "reason_required", f"{st} {j}")
    st, j = call("POST", "/admin/rooms/close", {"code": "BBBB", "reason": "spam oda"}, tm)
    check("kapatma 200", st == 200 and not j.get("deleted"), f"{st} {j}")
    conn = app.db()
    row = conn.execute("SELECT status, admin_closed FROM rooms WHERE code='BBBB'").fetchone()
    state = app.room_state(conn, "BBBB")
    conn.close()
    check("kapatılan oda finished + admin_closed", row["status"] == "finished" and row["admin_closed"] == 1,
          str(dict(row)))
    check("room_state adminClosed=true", state.get("adminClosed") is True, str(state.get("adminClosed")))
    st, j = call("POST", "/admin/rooms/close", {"code": "AAAA", "reason": "takıldı", "delete": True}, tm)
    check("sıfırlama (delete) 200", st == 200 and j.get("deleted") is True, f"{st} {j}")
    conn = app.db()
    gone = conn.execute("SELECT 1 FROM rooms WHERE code='AAAA'").fetchone()
    conn.close()
    check("silinen oda gitti", gone is None, "hâlâ var")

    # --- 5) DURUM ---
    st, j = call("GET", "/admin/status", token=tm)
    check("durum uptime + DB/WAL + oda + bot döner",
          st == 200 and "uptimeSeconds" in j and "dbSizeBytes" in j and "walSizeBytes" in j
          and "rooms" in j and "bots" in j and "recentErrors" in j, str(list(j.keys())))
    check("bot modülü sağlıklı", j["bots"]["moduleOk"] is True, str(j["bots"]))
    check("uptime >= 0", j["uptimeSeconds"] >= 0, str(j["uptimeSeconds"]))

    # --- 6) BAKIM ---
    st, j = call("POST", "/admin/maintenance", {"action": "cleanup_rooms"}, tm)
    check("cleanup_rooms 200 + sayı döner", st == 200 and "rooms" in j.get("result", {}), f"{st} {j}")
    conn = app.db()
    left = conn.execute("SELECT COUNT(*) AS n FROM rooms WHERE status='finished'").fetchone()["n"]
    conn.close()
    check("bitmiş odalar temizlendi", left == 0, str(left))
    st, j = call("POST", "/admin/maintenance", {"action": "vacuum"}, tm)
    check("vacuum 200", st == 200, f"{st} {j}")
    st, j = call("POST", "/admin/maintenance", {"action": "backup"}, tm)
    bakname = j.get("result", {}).get("backup", "")
    check("backup dosya üretir", st == 200 and bakname and
          os.path.exists(os.path.join(os.path.dirname(_tmp.name), bakname)), f"{st} {j}")
    st, j = call("POST", "/admin/maintenance", {"action": "bogus"}, tm)
    check("geçersiz bakım eylemi 400", st == 400, f"{st} {j}")

    # --- 7) ZAMANLANMIŞ fonksiyonlar doğrudan ---
    seed_room("DDDD", "finished", now, now)
    conn = app.db()
    res = monitor.cleanup_rooms(conn)
    monitor.backup(conn, _tmp.name, time.time())
    conn.close()
    check("zamanlanmış cleanup_rooms çalışır", isinstance(res.get("rooms"), int), str(res))

    # --- denetim ---
    conn = app.db()
    acts = [r["action"] for r in conn.execute("SELECT action FROM admin_audit")]
    conn.close()
    check("oda kapatma denetime yazıldı", "room_close" in acts, str(set(acts)))
    check("oda sıfırlama denetime yazıldı", "room_reset" in acts, str(set(acts)))
    check("bakım denetime yazıldı", any(a.startswith("maintenance:") for a in acts), str(set(acts)))

    print()
    if fails:
        print(f"BAŞARISIZ: {len(fails)} kontrol geçmedi -> {fails}")
        sys.exit(1)
    print("TÜM KONTROLLER GEÇTİ ✓ — canlı oda + sunucu izleme")


if __name__ == "__main__":
    try:
        main()
    finally:
        try:
            os.unlink(_tmp.name)
        except OSError:
            pass
