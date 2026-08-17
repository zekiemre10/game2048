"""
Skor tablosu moderasyonu — entegrasyon testi.

Doğrular:
  1. TESPİT: imkânsız kayıt (2048 karesi ama skor asgarinin altında) /admin/scores'ta
     işaretlenir; ilk temizlik raporu (/admin/scores/report) işaretlileri döker.
  2. YETKİ: normal kullanıcı /admin/scores ve invalidate'e 403.
  3. GEREKÇE ZORUNLU: reason'sız invalidate 400 reason_required.
  4. DÜŞÜRME: geçersiz kılınan kayıt aylık VE tüm-zamanlar tablosundan düşer.
  5. GERİ ALMA: revert sonrası kayıt tablolara döner (silme değil, işaretleme).
  6. ŞAMPİYONLUK: geçmiş ay şampiyonu geçersiz kılınınca ödül sıradaki GEÇERLİ
     oyuncuya geçer; ödül TALEP EDİLMİŞSE revoked=1 + claimed_conflict.
  7. BİLDİRİM: etkilenen kullanıcı /moderation/notices ile sebebi görür.
  8. DENETİM: her işlem admin_audit'e yazılır.

Çalıştır:  python server/test_score_moderation.py
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


def set_alltime(uid, score, tile):
    conn = app.db()
    conn.execute("UPDATE users SET data=? WHERE id=?",
                 (json.dumps({"bestScore": score, "bestTile": tile}), uid))
    conn.commit()
    conn.close()


def set_monthly(month, uid, uname, score, best):
    conn = app.db()
    conn.execute(
        "INSERT OR REPLACE INTO monthly_scores (month, user_id, username, score, best, updated) "
        "VALUES (?,?,?,?,?,?)", (month, uid, uname, score, best, 1))
    conn.commit()
    conn.close()


def leaderboard_ids(token, scope, month_field="top"):
    st, j = call("GET", f"/leaderboard?scope={scope}", token=token)
    return st, [p["id"] for p in j.get("top", [])]


def audit_actions():
    conn = app.db()
    rows = conn.execute("SELECT action FROM admin_audit").fetchall()
    conn.close()
    return [r["action"] for r in rows]


def main():
    fails = []

    def check(name, cond, detail=""):
        print(f"{'OK ' if cond else 'X  '} {name}{'' if cond else '  -> ' + detail}")
        if not cond:
            fails.append(name)

    ta, A = register("cheater")
    tb, B = register("honest")
    tm, M = register("mod")
    promote_admin("mod")

    month = app.utc_month()
    # cheater: imkânsız aylık kayıt (2048 karesi ama skor 100 << asgari 20480)
    set_monthly(month, A, "cheater", 100000, 2048)   # yüksek skor + 2048 karesi
    set_monthly(month, B, "honest", 40000, 1024)
    # Ama TESPİT için imkânsız olanı da koy: honest'a düşük-skor+yüksek-kare?
    # Asıl imkânsız örneği ayrı kullanıcıyla:
    tc, C = register("impossible")
    set_monthly(month, C, "impossible", 100, 2048)   # skor 100 < 2048 asgari 20480
    set_alltime(A, 100000, 2048)
    set_alltime(B, 40000, 1024)
    set_alltime(C, 100, 2048)

    # --- 1) TESPİT ---
    st, j = call("GET", f"/admin/scores?scope=monthly&flagged=1", token=tm)
    flagged_ids = {r["userId"] for r in j.get("records", [])}
    check("imkânsız kayıt işaretlenir", st == 200 and C in flagged_ids, f"{st} {flagged_ids}")
    imp = next((r for r in j["records"] if r["userId"] == C), None)
    check("işaret 'impossible' seviyesinde", imp and imp["severity"] == "impossible", str(imp))

    st, j = call("GET", "/admin/scores/report", token=tm)
    check("temizlik raporu işaretlileri döker", st == 200 and j.get("total_flagged", 0) >= 1,
          f"{st} {j.get('summary')}")

    # --- 2) YETKİ ---
    st, _ = call("GET", "/admin/scores", token=tb)
    check("normal kullanıcı /admin/scores 403", st == 403, str(st))
    st, _ = call("POST", "/admin/scores/invalidate",
                 {"userId": A, "scope": "monthly", "reason": "x"}, tb)
    check("normal kullanıcı invalidate 403", st == 403, str(st))

    # --- 3) GEREKÇE ZORUNLU ---
    st, j = call("POST", "/admin/scores/invalidate",
                 {"userId": A, "scope": "monthly"}, tm)
    check("gerekçesiz invalidate 400", st == 400 and j.get("error") == "reason_required", f"{st} {j}")

    # --- 4) DÜŞÜRME (aylık + tüm zamanlar) ---
    st, ids = leaderboard_ids(tm, "monthly")
    check("cheater önce aylık tabloda", A in ids, str(ids))
    st, j = call("POST", "/admin/scores/invalidate",
                 {"userId": A, "scope": "monthly", "reason": "hile: imkansiz artis"}, tm)
    check("aylık invalidate 200", st == 200, f"{st} {j}")
    st, ids = leaderboard_ids(tm, "monthly")
    check("cheater aylık tablodan DÜŞER", A not in ids, str(ids))
    check("honest aylık tabloda kalır", B in ids, str(ids))

    st, j = call("POST", "/admin/scores/invalidate",
                 {"userId": A, "scope": "alltime", "reason": "hile"}, tm)
    check("alltime invalidate 200", st == 200, f"{st} {j}")
    st, ids = leaderboard_ids(tm, "global")
    check("cheater tüm-zamanlar tablosundan DÜŞER", A not in ids, str(ids))

    # --- 5) GERİ ALMA ---
    st, j = call("POST", "/admin/scores/revert",
                 {"userId": A, "scope": "monthly"}, tm)
    check("monthly revert 200", st == 200, f"{st} {j}")
    st, ids = leaderboard_ids(tm, "monthly")
    check("revert sonrası cheater aylık tabloya DÖNER", A in ids, str(ids))
    st, j = call("POST", "/admin/scores/revert",
                 {"userId": A, "scope": "monthly"}, tm)
    check("zaten geçerli → revert 404", st == 404, f"{st} {j}")

    # --- 6) ŞAMPİYONLUK (geçmiş ay) ---
    past = "2020-05"
    set_monthly(past, A, "cheater", 999999, 4096)   # sahte şampiyon
    set_monthly(past, B, "honest", 50000, 1024)     # gerçek 2.
    conn = app.db()
    app.settle_finished_months(conn)
    prize = conn.execute("SELECT user_id, claimed FROM monthly_prizes WHERE month=?", (past,)).fetchone()
    conn.close()
    check("geçmiş ay şampiyonu cheater olarak yazıldı", prize and prize["user_id"] == A, str(dict(prize) if prize else None))

    st, j = call("POST", "/admin/scores/invalidate",
                 {"userId": A, "scope": "monthly", "period": past, "reason": "hile"}, tm)
    rs = j.get("resettle") or {}
    check("şampiyon geçersiz → resettle çalışır", st == 200 and rs.get("new") == B, f"{st} {j}")
    conn = app.db()
    prize2 = conn.execute("SELECT user_id FROM monthly_prizes WHERE month=?", (past,)).fetchone()
    conn.close()
    check("ödül gerçek 2.'ye (honest) geçer", prize2 and prize2["user_id"] == B, str(dict(prize2) if prize2 else None))

    # Ödül TALEP EDİLMİŞ senaryosu: yeni ay, talep edilmiş sahte şampiyon
    past2 = "2020-06"
    tc2, D = register("cheater2")
    set_monthly(past2, D, "cheater2", 888888, 4096)
    set_monthly(past2, B, "honest", 30000, 512)
    conn = app.db()
    app.settle_finished_months(conn)
    conn.execute("UPDATE monthly_prizes SET claimed=1 WHERE month=?", (past2,))  # ödül alınmış
    conn.commit()
    conn.close()
    st, j = call("POST", "/admin/scores/invalidate",
                 {"userId": D, "scope": "monthly", "period": past2, "reason": "hile"}, tm)
    rs = j.get("resettle") or {}
    check("talep edilmiş ödülde claimed_conflict", st == 200 and rs.get("claimed_conflict") is True, f"{st} {j}")
    conn = app.db()
    pz = conn.execute("SELECT user_id, revoked, claimed FROM monthly_prizes WHERE month=?", (past2,)).fetchone()
    conn.close()
    check("yeni kazanan honest + revoked işareti", pz and pz["user_id"] == B and pz["revoked"] == 1,
          str(dict(pz) if pz else None))

    # --- 7) BİLDİRİM ---
    st, j = call("GET", "/moderation/notices", token=ta)
    actions = [n["action"] for n in j.get("notices", [])]
    check("cheater bildirimde score_invalidated görür", "score_invalidated" in actions, str(actions))
    has_reason = any("hile" in (n.get("reason") or "") for n in j.get("notices", []))
    check("bildirim SEBEBİ içerir", has_reason, str(j.get("notices")))

    # --- 8) DENETİM ---
    acts = audit_actions()
    check("invalidate denetime yazıldı", "score_invalidate" in acts, str(set(acts)))
    check("revert denetime yazıldı", "score_revert" in acts, str(set(acts)))
    check("talep edilmiş ödül iptali denetime yazıldı", "prize_revoked_claimed" in acts, str(set(acts)))

    print()
    if fails:
        print(f"BAŞARISIZ: {len(fails)} kontrol geçmedi -> {fails}")
        sys.exit(1)
    print("TÜM KONTROLLER GEÇTİ ✓ — skor tablosu moderasyonu")


if __name__ == "__main__":
    try:
        main()
    finally:
        try:
            os.unlink(_tmp.name)
        except OSError:
            pass
