"""
Metrik panosu — entegrasyon testi.

Doğrular:
  1. YETKİ: normal kullanıcı /admin/metrics 403; admin 200 + tüm gruplar.
  2. KULLANICI: toplam + aralıkta yeni + kayıt eğrisi; auth aktifliği DAU'ya yansır.
  3. OLAY: anonim POST /events (auth'suz) mod dağılımına düşer.
  4. HUNİ: seviye hunisi bestLevel'i yansıtır (L'ye ulaşan >= L+1'e ulaşan).
  5. SKOR: skor dağılımı kovaları.
  6. ÇEVRİMİÇİ: arkadaşlık/mesaj kullanım oranları.
  7. TUTUNMA: kohort D+1 dönüşü d1'e yansır.
  8. TARİH ARALIĞI: geçersiz/ters aralık 400.
  9. BOŞ DURUM: veri olmayan aralık sıfır döner, çökmez.
 10. GİZLİLİK: yanıt hiçbir kullanıcı adı/e-posta İÇERMEZ (yalnız toplamlar).
 11. SAĞLIK: istek sayacı + DB boyutu döner.

Çalıştır:  python server/test_metrics.py
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


def set_blob(uid, score, level):
    conn = app.db()
    conn.execute("UPDATE users SET data=? WHERE id=?",
                 (json.dumps({"bestScore": score, "bestLevel": level}), uid))
    conn.commit()
    conn.close()


def ts_day(day):
    import calendar
    return calendar.timegm(time.strptime(day, "%Y-%m-%d"))  # UTC (yerelden bağımsız)


def main():
    fails = []

    def check(name, cond, detail=""):
        print(f"{'OK ' if cond else 'X  '} {name}{'' if cond else '  -> ' + detail}")
        if not cond:
            fails.append(name)

    ta, A = register("ada")
    tb, B = register("boran")
    tm, M = register("metricadmin")
    promote_admin("metricadmin")

    set_blob(A, 25000, 5)
    set_blob(B, 800, 2)
    tc, C = register("secretplayer")
    set_blob(C, 120000, 12)

    # Arkadaşlık + mesaj (çevrimiçi kullanım)
    call("POST", "/friends/request", {"id": B}, ta)
    call("POST", "/friends/request", {"id": A}, tb)
    call("POST", "/messages", {"to": B, "body": "selam"}, ta)

    # Anonim olaylar (mod dağılımı)
    for _ in range(3):
        call("POST", "/events", {"name": "game_start", "mode": "classic"})
    call("POST", "/events", {"name": "game_start", "mode": "zen"})
    st_ev, _ = call("POST", "/events", {"name": "game_start", "mode": "hackmode"})  # geçersiz mod
    check("geçersiz modlu olay yine 200 (mode=NULL sayılır)", st_ev == 200, str(st_ev))

    today = app.metrics.today()

    # --- 1) YETKİ ---
    st, _ = call("GET", "/admin/metrics", token=tb)
    check("normal kullanıcı /admin/metrics 403", st == 403, str(st))
    st, j = call("GET", "/admin/metrics", token=tm)
    groups = ["users", "retention", "modes", "levelFunnel", "scoreDistribution", "online", "health"]
    check("admin 200 + tüm gruplar", st == 200 and all(g in j for g in groups),
          f"{st} {list(j.keys())}")

    # --- 2) KULLANICI + aktiflik ---
    check("toplam kullanıcı >= 4", j["users"]["total"] >= 4, str(j["users"]["total"]))
    check("aralıkta yeni kayıt >= 4", j["users"]["newInRange"] >= 4, str(j["users"]["newInRange"]))
    check("auth aktifliği DAU'ya yansır (ta çağrı yaptı)", j["users"]["dau"] >= 1, str(j["users"]["dau"]))

    # --- 3) MOD DAĞILIMI ---
    modes = {m["mode"]: m["count"] for m in j["modes"]}
    check("classic 3 olay", modes.get("classic") == 3, str(modes))
    check("zen 1 olay", modes.get("zen") == 1, str(modes))

    # --- 4) SEVİYE HUNİSİ ---
    funnel = {f["level"]: f["players"] for f in j["levelFunnel"]}
    check("L1'e ulaşan >= L2'ye ulaşan (huni azalır)", funnel.get(1, 0) >= funnel.get(2, 0), str(funnel))
    check("L12'ye ulaşan >= 1 (secretplayer)", funnel.get(12, 0) >= 1, str(funnel))

    # --- 5) SKOR DAĞILIMI ---
    total_scored = sum(b["count"] for b in j["scoreDistribution"])
    check("skor dağılımı tüm kullanıcıları kapsar", total_scored == j["users"]["total"],
          f"{total_scored} vs {j['users']['total']}")

    # --- 6) ÇEVRİMİÇİ ---
    check("arkadaşı olan >= 2", j["online"]["withFriend"] >= 2, str(j["online"]))
    check("mesaj gönderen >= 1", j["online"]["chatSenders"] >= 1, str(j["online"]))

    # --- 7) TUTUNMA (kohort) ---
    past = "2020-03-10"
    conn = app.db()
    conn.execute("UPDATE users SET created=? WHERE id=?", (ts_day(past), B))
    conn.execute("INSERT OR IGNORE INTO user_activity(user_id, day) VALUES (?,?)",
                 (B, "2020-03-11"))  # D+1 döndü
    conn.commit()
    conn.close()
    st, j2 = call("GET", "/admin/metrics?from=2020-03-01&to=2020-03-20", token=tm)
    check("kohort D+1 dönüşü d1'e yansır (100)", j2["retention"]["d1"] == 100.0,
          str(j2["retention"]))

    # --- 8) TARİH ARALIĞI ---
    st, _ = call("GET", "/admin/metrics?from=2020-13-99&to=2020-01-01", token=tm)
    check("geçersiz tarih 400", st == 400, str(st))
    st, _ = call("GET", "/admin/metrics?from=2025-01-10&to=2025-01-01", token=tm)
    check("ters aralık (from>to) 400", st == 400, str(st))

    # --- 9) BOŞ DURUM ---
    st, j3 = call("GET", "/admin/metrics?from=1990-01-01&to=1990-01-05", token=tm)
    check("boş aralık çökmeden sıfır döner",
          st == 200 and j3["users"]["newInRange"] == 0 and j3["modes"][0]["count"] == 0,
          f"{st}")

    # --- 10) GİZLİLİK: PII yok ---
    blob = json.dumps(j) + json.dumps(j2)
    check("yanıt kullanıcı adı içermez", "secretplayer" not in blob and "ada" not in blob.replace("daily", ""),
          "kullanıcı adı sızdı")
    check("yanıt e-posta içermez", "@test.com" not in blob, "e-posta sızdı")

    # --- 11) SAĞLIK ---
    check("istek sayacı > 0", j["health"]["requests"] > 0, str(j["health"]["requests"]))
    check("DB boyutu döner", isinstance(j["health"]["dbSizeBytes"], int) and j["health"]["dbSizeBytes"] > 0,
          str(j["health"]["dbSizeBytes"]))

    print()
    if fails:
        print(f"BAŞARISIZ: {len(fails)} kontrol geçmedi -> {fails}")
        sys.exit(1)
    print("TÜM KONTROLLER GEÇTİ ✓ — metrik panosu")


if __name__ == "__main__":
    try:
        main()
    finally:
        try:
            os.unlink(_tmp.name)
        except OSError:
            pass
