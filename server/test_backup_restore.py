"""
Yedekleme + GERİ YÜKLEME — otomatik test (kabul kriteri: en az bir kez denenmeli).

Canlı sunucu app.db üzerinde çalışırken:
  1. Kullanıcı + ilerleme kaydedilir.
  2. SICAK (online) yedek alınır — SQLite .backup mekanizması (conn.backup),
     backup.sh ile AYNI; düz `cp` DEĞİL (açık DB'de kopya bozuk olabilir).
  3. Veri KAYBI simüle edilir (kullanıcı DB'den silinir) → giriş artık başarısız.
  4. Yedekten GERİ YÜKLENİR (dosya yerine konur) → giriş yine başarılı, veri sağlam.

Böylece "yedekten geri dönme en az bir kez denenmiş" kriteri otomatik/tekrarlanır
şekilde karşılanır. Çalıştır:  python server/test_backup_restore.py
"""
import json
import os
import shutil
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
DB = _tmp.name
os.environ["GAME2048_DB"] = DB

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


def hot_backup(src_path, dst_path):
    """backup.sh ile aynı: SQLite .backup (çevrimiçi tutarlı kopya)."""
    src = sqlite3.connect(src_path)
    dst = sqlite3.connect(dst_path)
    with dst:
        src.backup(dst)
    # Bütünlük doğrula
    ok = dst.execute("PRAGMA integrity_check;").fetchone()[0]
    src.close()
    dst.close()
    return ok


def main():
    fails = []

    def check(cond, msg):
        print(("  ✓ " if cond else "  ✗ ") + msg)
        if not cond:
            fails.append(msg)

    # 1) Kullanıcı + ilerleme
    st, j = call("POST", "/register", {
        "username": "yedekci", "password": "parola123", "email": "y@b.com",
        "data": {"v": 2, "gold": 500, "totalGoldEarned": 500, "bestScore": 12345, "achievements": ["a1"]},
    })
    check(st == 200 and j.get("token"), "kullanıcı + ilerleme kaydedildi")

    # 2) SICAK yedek (sunucu çalışırken)
    backup_path = DB + ".bak"
    ok = hot_backup(DB, backup_path)
    check(ok == "ok" and os.path.getsize(backup_path) > 0,
          f"sıcak yedek alındı ve bütünlük ok ({ok})")

    # 3) Veri KAYBI simülasyonu: kullanıcıyı DB'den sil
    conn = sqlite3.connect(DB)
    conn.execute("DELETE FROM users WHERE username_lower='yedekci'")
    conn.commit()
    conn.close()
    st, _ = call("POST", "/login", {"username": "yedekci", "password": "parola123"})
    check(st == 401, f"veri kaybı doğrulandı: giriş artık başarısız ({st})")

    # 4) GERİ YÜKLEME: yedeği yerine koy (servis kısa-ömürlü bağlantı kullanır,
    #    dosya güvenle değiştirilebilir), sonra veri geri gelmeli.
    shutil.copyfile(backup_path, DB)
    st, j = call("POST", "/login", {"username": "yedekci", "password": "parola123"})
    check(st == 200 and j.get("token"), f"geri yükleme sonrası giriş başarılı ({st})")
    if st == 200:
        _, me = call("GET", "/me", token=j["token"])
        d = me.get("data", {})
        check(d.get("gold") == 500 and d.get("bestScore") == 12345 and d.get("achievements") == ["a1"],
              f"geri yüklenen ilerleme sağlam (gold={d.get('gold')} best={d.get('bestScore')})")

    print()
    if fails:
        print(f"BAŞARISIZ: {len(fails)} kontrol geçmedi")
        sys.exit(1)
    print("TÜM KONTROLLER GEÇTİ ✓ — yedekten geri dönme çalışıyor (kayıp → geri yükleme → sağlam)")


if __name__ == "__main__":
    try:
        main()
    finally:
        for p in (DB, DB + ".bak"):
            try:
                os.unlink(p)
            except OSError:
                pass
