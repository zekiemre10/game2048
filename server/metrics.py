"""Metrik panosu sorguları — kullanıcı/tutunma/mod/huni/skor/çevrimiçi/sağlık.

Var olan tablolardan (users, monthly_scores, friendships, messages, room_players)
+ üç hafif ANONİM tablodan (user_activity, events, daily_metrics) toplu metrik
üretir. **Kişisel veri YOK:** çıktı yalnız toplam sayı/oran/kova; ham kimlik,
ad, e-posta, IP DÖNMEZ. `app.py` bunu import eder → DEPLOY'da app.py ILE BIRLIKTE
gönderilmeli (yoksa servis çöker; bkz. game2048-backend-deploy).

Saf: her fonksiyon bir sqlite bağlantısı alır, yan etki (yazma) yalnız
record_* çağrılarında olur. Tarih anahtarları UTC `YYYY-MM-DD`.
"""
import calendar
import json
import os
import time

# İstemci GameMode enum'ıyla BİREBİR (kayıpsız). Panoda ilk 5 ana mod öne çıkar.
VALID_MODES = ("classic", "zen", "timeAttack", "level", "daily", "race", "puzzle")
VALID_EVENTS = ("game_start", "game_over")

# Skor dağılımı kovaları (üst sınırlar; son kova = +∞).
SCORE_BUCKETS = (500, 1000, 2000, 5000, 10000, 20000, 50000, 100000)


def day_of(ts: int) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(int(ts)))


def today() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


def day_start_ts(day: str) -> int:
    """UTC gün başlangıcının epoch'u (yerel saat diliminden BAĞIMSIZ)."""
    return calendar.timegm(time.strptime(day, "%Y-%m-%d"))


def _day_add(day: str, n: int) -> str:
    """UTC gün + n (yerel saat diliminden bağımsız)."""
    return time.strftime("%Y-%m-%d", time.gmtime(day_start_ts(day) + n * 86400))


# ---- Sunucu sağlığı sayaçları (istek/hata) ------------------------------
# İstek başına DB yazmamak için bellekte biriktir; flush() ara sıra günlük
# satıra işler (yeniden başlatmada en fazla son tamponu kaybederiz — kabul).
import threading as _threading

_counter_lock = _threading.Lock()
_pending = {}  # day -> [requests, errors]


def bump_request(is_error: bool = False) -> None:
    d = today()
    with _counter_lock:
        cell = _pending.setdefault(d, [0, 0])
        cell[0] += 1
        if is_error:
            cell[1] += 1


def flush_counters(conn) -> None:
    """Biriken istek/hata sayaçlarını daily_metrics'e işler (toplayarak)."""
    with _counter_lock:
        if not _pending:
            return
        snapshot = dict(_pending)  # KOPYA — clear() aynı nesneyi boşaltmasın
        _pending.clear()
    try:
        for day, (req, err) in snapshot.items():
            conn.execute(
                "INSERT INTO daily_metrics (day, requests, errors) VALUES (?,?,?) "
                "ON CONFLICT(day) DO UPDATE SET requests=requests+?, errors=errors+?",
                (day, req, err, req, err),
            )
        conn.commit()
    except Exception:
        # yazamazsak sayaçları geri koy (kayıp olmasın)
        with _counter_lock:
            for day, (req, err) in snapshot.items():
                cell = _pending.setdefault(day, [0, 0])
                cell[0] += req
                cell[1] += err


# ---- Yazma (enstrümantasyon) --------------------------------------------

_seen_activity = set()  # (user_id, day) — aynı gün tekrar DB'ye yazma


def record_activity(conn, user_id: int) -> None:
    """Kullanıcının BUGÜN aktif olduğunu işaretle (günde tek satır, ucuz).
    Bellek koruması: aynı kullanıcı+gün için istek başına DB'ye YAZMAZ."""
    key = (int(user_id), today())
    if key in _seen_activity:
        return
    try:
        conn.execute(
            "INSERT OR IGNORE INTO user_activity (user_id, day) VALUES (?,?)", key)
        conn.commit()
        _seen_activity.add(key)
        if len(_seen_activity) > 20000:  # gün dönümü birikimini sınırla
            _seen_activity.clear()
    except Exception:
        pass  # metrik kritik yol değil — asla isteği düşürme


def record_event(conn, name: str, mode=None, level=None, score=None) -> bool:
    """Anonim olay yaz (mod dağılımı vb.). Doğrulanır; PII yok."""
    if name not in VALID_EVENTS:
        return False
    m = mode if mode in VALID_MODES else None
    lv = int(level) if isinstance(level, (int, float)) and 0 <= level <= 999 else None
    sc = int(score) if isinstance(score, (int, float)) and 0 <= score <= 10_000_000 else None
    conn.execute(
        "INSERT INTO events (ts, name, mode, level, score) VALUES (?,?,?,?,?)",
        (int(time.time()), name, m, lv, sc),
    )
    conn.commit()
    return True


# ---- Okuma (pano) --------------------------------------------------------

def _score_of(data):
    try:
        d = json.loads(data or "{}")
    except Exception:
        return 0, 1
    return int(d.get("bestScore") or 0), int(d.get("bestLevel") or 1)


def compute(conn, d_from: str, d_to: str, db_path=None) -> dict:
    """[d_from, d_to] (dahil) aralığı için tüm metrik grupları. Veri yoksa
    sıfır/boş döner (arayüz bozulmaz)."""
    ts_from = day_start_ts(d_from)
    ts_to = day_start_ts(d_to) + 86400  # gün sonu (dahil)

    return {
        "range": {"from": d_from, "to": d_to},
        "users": _users(conn, d_from, d_to, ts_from, ts_to),
        "retention": _retention(conn, d_from, d_to),
        "modes": _modes(conn, ts_from, ts_to),
        "levelFunnel": _level_funnel(conn),
        "scoreDistribution": _score_dist(conn),
        "online": _online(conn),
        "health": _health(conn, d_from, d_to, db_path),
    }


def _users(conn, d_from, d_to, ts_from, ts_to):
    total = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
    new_in = conn.execute(
        "SELECT COUNT(*) AS n FROM users WHERE created >= ? AND created < ?",
        (ts_from, ts_to),
    ).fetchone()["n"]
    # Kayıt eğrisi (gün bazında)
    curve = {}
    for r in conn.execute(
        "SELECT created FROM users WHERE created >= ? AND created < ?", (ts_from, ts_to)
    ):
        d = day_of(r["created"])
        curve[d] = curve.get(d, 0) + 1
    signup_curve = [{"day": d, "count": c} for d, c in sorted(curve.items())]
    # Aktif kullanıcı: bugün (DAU) / son 7 gün (WAU) / aralıkta
    dau = conn.execute("SELECT COUNT(DISTINCT user_id) AS n FROM user_activity WHERE day=?",
                       (today(),)).fetchone()["n"]
    wau = conn.execute(
        "SELECT COUNT(DISTINCT user_id) AS n FROM user_activity WHERE day >= ?",
        (_day_add(today(), -6),),
    ).fetchone()["n"]
    active_range = conn.execute(
        "SELECT COUNT(DISTINCT user_id) AS n FROM user_activity WHERE day >= ? AND day <= ?",
        (d_from, d_to),
    ).fetchone()["n"]
    return {"total": total, "newInRange": new_in, "signupCurve": signup_curve,
            "dau": dau, "wau": wau, "activeInRange": active_range}


def _retention(conn, d_from, d_to):
    """Kohort bazlı: gün D'de kayıt olanların D+1 (d1) ve D+1..D+7 (d7) içinde
    dönme oranı — aralıktaki kohortlar üzerinden toplanır."""
    # Kohortlar: created günü aralıkta olan kullanıcılar
    cohort = {}  # day -> [user_ids]
    for r in conn.execute("SELECT id, created FROM users"):
        d = day_of(r["created"])
        if d_from <= d <= d_to:
            cohort.setdefault(d, []).append(r["id"])
    d1_num = d1_den = d7_num = d7_den = 0
    for d, ids in cohort.items():
        idset = set(ids)
        # D+1 aktivitesi
        nxt = _day_add(d, 1)
        act1 = {r["user_id"] for r in conn.execute(
            "SELECT user_id FROM user_activity WHERE day=?", (nxt,)) if r["user_id"] in idset}
        d1_num += len(act1)
        d1_den += len(ids)
        # D+1..D+7 aktivitesi (D+7 kohortu tamamlanmışsa)
        if _day_add(d, 7) <= today():
            lo, hi = _day_add(d, 1), _day_add(d, 7)
            act7 = {r["user_id"] for r in conn.execute(
                "SELECT DISTINCT user_id FROM user_activity WHERE day>=? AND day<=?", (lo, hi))
                if r["user_id"] in idset}
            d7_num += len(act7)
            d7_den += len(ids)
    return {
        "d1": round(100 * d1_num / d1_den, 1) if d1_den else 0,
        "d7": round(100 * d7_num / d7_den, 1) if d7_den else 0,
        "d1Cohort": d1_den, "d7Cohort": d7_den,
    }


def _modes(conn, ts_from, ts_to):
    rows = conn.execute(
        "SELECT mode, COUNT(*) AS n FROM events "
        "WHERE name='game_start' AND mode IS NOT NULL AND ts>=? AND ts<? "
        "GROUP BY mode", (ts_from, ts_to),
    ).fetchall()
    counts = {r["mode"]: r["n"] for r in rows}
    return [{"mode": m, "count": counts.get(m, 0)} for m in VALID_MODES]


def _level_funnel(conn):
    """Seviye modu hunisi: L seviyesine ULAŞAN oyuncu sayısı (bestLevel>=L).
    L ve L+1 arası düşüş = oyuncuların bıraktığı yer. users.data'dan (şu an var)."""
    levels = {}
    max_lv = 1
    for r in conn.execute("SELECT data FROM users"):
        _, lv = _score_of(r["data"])
        lv = max(1, lv)
        max_lv = max(max_lv, lv)
        levels[lv] = levels.get(lv, 0) + 1
    max_lv = min(max_lv, 50)  # makul üst sınır
    funnel = []
    for L in range(1, max_lv + 1):
        reached = sum(c for lv, c in levels.items() if lv >= L)
        funnel.append({"level": L, "players": reached})
    return funnel


def _score_dist(conn):
    counts = [0] * (len(SCORE_BUCKETS) + 1)
    for r in conn.execute("SELECT data FROM users"):
        sc, _ = _score_of(r["data"])
        placed = False
        for i, top in enumerate(SCORE_BUCKETS):
            if sc < top:
                counts[i] += 1
                placed = True
                break
        if not placed:
            counts[-1] += 1
    labels = []
    prev = 0
    for top in SCORE_BUCKETS:
        labels.append(f"{prev}-{top}")
        prev = top
    labels.append(f"{prev}+")
    return [{"range": labels[i], "count": counts[i]} for i in range(len(counts))]


def _online(conn):
    total = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
    with_friend = conn.execute(
        "SELECT COUNT(DISTINCT uid) AS n FROM ("
        "  SELECT requester_id AS uid FROM friendships WHERE status='accepted' "
        "  UNION SELECT addressee_id AS uid FROM friendships WHERE status='accepted')"
    ).fetchone()["n"]
    msg_senders = conn.execute(
        "SELECT COUNT(DISTINCT from_id) AS n FROM messages").fetchone()["n"]
    in_room = conn.execute(
        "SELECT COUNT(DISTINCT user_id) AS n FROM room_players WHERE user_id > 0"
    ).fetchone()["n"]
    friendships = conn.execute(
        "SELECT COUNT(*) AS n FROM friendships WHERE status='accepted'").fetchone()["n"]
    messages = conn.execute("SELECT COUNT(*) AS n FROM messages").fetchone()["n"]
    rooms = conn.execute("SELECT COUNT(*) AS n FROM rooms").fetchone()["n"]
    pct = lambda a: round(100 * a / total, 1) if total else 0
    return {
        "totalUsers": total,
        "withFriend": with_friend, "withFriendPct": pct(with_friend),
        "chatSenders": msg_senders, "chatSendersPct": pct(msg_senders),
        "playedMultiplayer": in_room, "playedMultiplayerPct": pct(in_room),
        "friendships": friendships, "messages": messages, "rooms": rooms,
    }


def _health(conn, d_from, d_to, db_path):
    row = conn.execute(
        "SELECT COALESCE(SUM(requests),0) AS req, COALESCE(SUM(errors),0) AS err "
        "FROM daily_metrics WHERE day>=? AND day<=?", (d_from, d_to),
    ).fetchone()
    req, err = row["req"], row["err"]
    daily = [dict(r) for r in conn.execute(
        "SELECT day, requests, errors FROM daily_metrics WHERE day>=? AND day<=? ORDER BY day",
        (d_from, d_to))]
    size = None
    backups = {"count": 0, "latest": None}
    if db_path:
        try:
            size = os.path.getsize(db_path)
        except OSError:
            pass
        try:
            d = os.path.dirname(os.path.abspath(db_path))
            base = os.path.basename(db_path)
            baks = [f for f in os.listdir(d) if f.startswith(base + ".bak")]
            backups["count"] = len(baks)
            if baks:
                latest = max(baks, key=lambda f: os.path.getmtime(os.path.join(d, f)))
                backups["latest"] = time.strftime(
                    "%Y-%m-%d %H:%M", time.gmtime(os.path.getmtime(os.path.join(d, latest))))
        except OSError:
            pass
    return {
        "requests": req, "errors": err,
        "errorRate": round(100 * err / req, 2) if req else 0,
        "dbSizeBytes": size, "backups": backups, "daily": daily,
    }
