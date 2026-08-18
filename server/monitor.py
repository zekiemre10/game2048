"""Canlı oda + sunucu izleme — oda özeti, takılmış tespiti, sağlık, bakım.

`app.py` bunu import eder → DEPLOY'da app.py ILE BIRLIKTE gönderilmeli (yoksa
servis çöker; bkz. game2048-backend-deploy). Fonksiyonlar bir sqlite bağlantısı
(ve gerekli yolları/sayaçları) alır; kişisel veri döndürmez (oda kodu + toplam
sayılar; oyuncu adları oda listesinde tutulmaz).
"""
import os
import shutil
import time

# Yarış bitişinden sonra hâlâ 'racing' kalırsa TAKILMIŞ say (lazy-finish çalışmamış).
STUCK_GRACE = 120
# 'lobby'de bu kadar beklemiş (hiç başlamamış) oda da takılmış/terk sayılır.
LOBBY_STUCK = 3600


def rss_bytes():
    """Sürecin yerleşik bellek kullanımı (bayt). Linux /proc; yoksa resource."""
    try:
        with open("/proc/self/status", encoding="ascii") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) * 1024
    except OSError:
        pass
    try:
        import resource
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
    except Exception:
        return None


def file_size(path):
    try:
        return os.path.getsize(path)
    except OSError:
        return None


def is_stuck(status, started_at, duration, created, now, grace=STUCK_GRACE):
    """Oda takılmış mı: (a) süresi + pay kadar geçmiş ama hâlâ 'racing', ya da
    (b) uzun süredir 'lobby'de (hiç başlamamış)."""
    if status == "racing" and started_at and now > int(started_at) + int(duration) + grace:
        return True
    if status == "lobby" and now > int(created) + LOBBY_STUCK:
        return True
    return False


def list_rooms(conn, now=None):
    """Tüm odalar + oyuncu/bot sayısı + yaş + takılmış bayrağı (en yeni önce).
    Oyuncu ADLARI DÖNMEZ (yalnız sayı) — izleme için kimlik gerekmez."""
    now = now or int(time.time())
    rooms = conn.execute(
        "SELECT code, status, duration, started_at, created FROM rooms "
        "ORDER BY created DESC LIMIT 500"
    ).fetchall()
    out = []
    for r in rooms:
        pr = conn.execute(
            "SELECT user_id FROM room_players WHERE code=?", (r["code"],)).fetchall()
        humans = sum(1 for p in pr if p["user_id"] > 0)
        bots = sum(1 for p in pr if p["user_id"] < 0)
        out.append({
            "code": r["code"], "status": r["status"],
            "players": humans, "bots": bots, "hasBot": bots > 0,
            "created": r["created"], "ageSeconds": now - r["created"],
            "startedAt": r["started_at"] or 0,
            "stuck": is_stuck(r["status"], r["started_at"], r["duration"], r["created"], now),
        })
    return out


def room_counts(conn):
    rows = conn.execute("SELECT status, COUNT(*) AS n FROM rooms GROUP BY status").fetchall()
    by = {r["status"]: r["n"] for r in rows}
    return {
        "total": sum(by.values()),
        "lobby": by.get("lobby", 0),
        "racing": by.get("racing", 0),
        "finished": by.get("finished", 0),
    }


def bot_health(conn, now=None):
    """Sunucu botu sağlığı: aktif odalardaki bot sayısı + modül çalışıyor mu.
    Botlar sunucuda deterministik üretilir → skor 'makul'dür; burada varlık +
    modül sağlığı raporlanır (skor doğrulaması score_audit'in işi)."""
    now = now or int(time.time())
    active_bots = conn.execute(
        "SELECT COUNT(*) AS n FROM room_players p JOIN rooms r ON r.code=p.code "
        "WHERE p.user_id < 0 AND r.status='racing'"
    ).fetchone()["n"]
    total_bots = conn.execute(
        "SELECT COUNT(*) AS n FROM room_players WHERE user_id < 0").fetchone()["n"]
    module_ok = True
    try:
        import bot_ai  # noqa: F401
    except Exception:
        module_ok = False
    return {"activeBots": active_bots, "totalBots": total_bots, "moduleOk": module_ok}


def backup_status(db_path):
    """En son yedek + toplam yedek sayısı (app.db.bak-* dosyaları)."""
    out = {"count": 0, "latest": None, "latestTs": 0}
    try:
        d = os.path.dirname(os.path.abspath(db_path))
        base = os.path.basename(db_path)
        baks = [f for f in os.listdir(d) if f.startswith(base + ".bak")]
        out["count"] = len(baks)
        if baks:
            latest = max(baks, key=lambda f: os.path.getmtime(os.path.join(d, f)))
            ts = int(os.path.getmtime(os.path.join(d, latest)))
            out["latest"] = time.strftime("%Y-%m-%d %H:%M", time.gmtime(ts))
            out["latestTs"] = ts
    except OSError:
        pass
    return out


def server_status(conn, db_path, start_ts, recent_errors, now=None):
    """Sunucu sağlığı: çalışma süresi, bellek, DB + WAL boyutu, yedek, hata oranı,
    son hataların özeti, oda sayıları, bot sağlığı."""
    now = now or int(time.time())
    day = time.strftime("%Y-%m-%d", time.gmtime(now))
    row = conn.execute(
        "SELECT requests, errors FROM daily_metrics WHERE day=?", (day,)).fetchone()
    req = row["requests"] if row else 0
    err = row["errors"] if row else 0
    return {
        "uptimeSeconds": now - int(start_ts),
        "memoryBytes": rss_bytes(),
        "dbSizeBytes": file_size(db_path),
        "walSizeBytes": file_size(db_path + "-wal"),
        "backups": backup_status(db_path),
        "today": {"requests": req, "errors": err,
                  "errorRate": round(100 * err / req, 2) if req else 0},
        "recentErrors": list(recent_errors),
        "rooms": room_counts(conn),
        "bots": bot_health(conn, now),
    }


# ---- Bakım eylemleri (elle tetiklenir + zamanlanmış koşar) ----------------

def cleanup_rooms(conn, now=None):
    """Bitmiş odaları + 6 saatten eski odaları + yetim oyuncu satırlarını temizler.
    Dönen: {rooms, orphanPlayers}."""
    now = now or int(time.time())
    old = now - 6 * 3600
    victims = [r["code"] for r in conn.execute(
        "SELECT code FROM rooms WHERE status='finished' OR created < ?", (old,))]
    n_rooms = 0
    if victims:
        marks = ",".join("?" for _ in victims)
        conn.execute(f"DELETE FROM room_players WHERE code IN ({marks})", tuple(victims))
        cur = conn.execute(f"DELETE FROM rooms WHERE code IN ({marks})", tuple(victims))
        n_rooms = cur.rowcount if cur.rowcount is not None else len(victims)
    # Yetim oyuncular (odası kalmamış)
    cur = conn.execute(
        "DELETE FROM room_players WHERE code NOT IN (SELECT code FROM rooms)")
    orphans = cur.rowcount if cur.rowcount is not None else 0
    conn.commit()
    return {"rooms": n_rooms, "orphanPlayers": orphans}


def vacuum(conn):
    """SQLite VACUUM — dosyayı sıkıştırır (silinen satırların yerini geri alır)."""
    conn.execute("VACUUM")
    conn.commit()


def backup(conn, db_path, now_ts):
    """WAL'ı checkpoint'leyip DB'nin tutarlı bir kopyasını `app.db.bak-<ts>` yazar.
    now_ts DIŞARIDAN verilir (zaman damgası çağıranın sorumluluğu). Dönen: yol."""
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except Exception:
        pass
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime(int(now_ts)))
    dest = f"{db_path}.bak-{stamp}"
    shutil.copyfile(db_path, dest)
    return dest
