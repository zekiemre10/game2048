#!/usr/bin/env python3
"""
2048 — Hesap servisi (kayıt / giriş / senkron)
Python stdlib: http.server + sqlite3 + hashlib(pbkdf2). Backend yok bağımlılık.
Airport Manager'ın emre-app servisine benzer yapıda, ayrı port/DB.

Endpoint'ler (JSON):
  GET  /health                        -> {ok:true}
  POST /register {username,password}  -> {token, user}
  POST /login    {username,password}  -> {token, user}
  POST /logout   (Bearer)             -> {ok:true}
  GET  /me       (Bearer)             -> {user, data}
  POST /sync     (Bearer) {data}      -> {ok:true}   (hesaba ilerleme kaydı)

Sonraki fazlar (arkadaşlar/sohbet/çok oyunculu) buraya eklenecek;
tablolar şimdiden hazır.
"""
import json
import os
import re
import sqlite3
import hashlib
import secrets
import time
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Skoru istemciden değil, tohum+hamleden SUNUCU hesaplar (hile önleme).
from replay import replay_game, daily_seed

DB_PATH = os.environ.get("GAME2048_DB", os.path.join(os.path.dirname(__file__), "app.db"))
PORT = int(os.environ.get("GAME2048_PORT", "8092"))

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.\-çğışöüÇĞİŞÖÜ ]{2,20}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PBKDF2_ITERS = 600_000  # OWASP 2024 önerisi (PBKDF2-SHA256)
LEGACY_ITERS = 120_000  # eski hesapların hash'i (girişte yükseltilir)
TOKEN_TTL = 60 * 60 * 24 * 90  # 90 gün
MAX_BODY = 256 * 1024  # istek gövdesi üst sınırı (bellek koruması)
MAX_DATA = 64 * 1024  # /sync ile saklanabilecek en büyük ilerleme kaydı
MAX_SCORE = 10_000_000  # makul üst sınır (uydurma skorları ele)

# Ay sonu şampiyonluk ödülü — bilinçli olarak BÜYÜK: bir aylık rekabetin
# karşılığı, normal günlük ödüllerin çok üzerinde olmalı.
CHAMPION_PRIZE = {
    "gold": 2000,
    "powers": {"time": 3, "bomb": 3, "shuffle": 3, "undo": 3, "hint": 3},
}

# --- Skor doğrulama (replay) ----------------------------------
MAX_MOVES = 100_000  # transkript üst sınırı (uzun oyun ~1000-3000 hamle)
VALID_SIZES = (3, 4, 5)
SUBMIT_MAX = 20       # kullanıcı başına pencere başına skor gönderimi
SUBMIT_WINDOW = 60    # saniye

LOGIN_MAX_TRIES = 10  # aynı kullanıcı adı için pencere başına deneme
# Kısa pencere bilinçli bir tercih: kaba kuvvetin hızını keser ama parolasını
# birkaç kez yanlış giren gerçek kullanıcıyı uzun süre dışarıda bırakmaz.
LOGIN_WINDOW = 120  # saniye


class BadRequest(Exception):
    """İstemci hatası → 400 (mesaj, çeviri anahtarı olarak döner)."""


# Basit bellek içi giriş hız sınırı: {kullanıcı_adı: [zaman damgaları]}
_login_tries = {}
_login_lock = threading.Lock()


def login_allowed(username_lower: str) -> bool:
    """Kaba kuvvet denemelerini yavaşlatır (kalıcı depo gerektirmez)."""
    now = time.time()
    with _login_lock:
        # Farklı kullanıcı adlarıyla sözlüğü sonsuza dek şişirmeyi önle:
        # penceresi dolmuş kayıtları fırsat buldukça temizle.
        if len(_login_tries) > 4096:
            for u in [u for u, ts in _login_tries.items()
                      if not any(now - t < LOGIN_WINDOW for t in ts)]:
                del _login_tries[u]
        tries = [t for t in _login_tries.get(username_lower, []) if now - t < LOGIN_WINDOW]
        if len(tries) >= LOGIN_MAX_TRIES:
            _login_tries[username_lower] = tries
            return False
        tries.append(now)
        _login_tries[username_lower] = tries
        return True


def login_succeeded(username_lower: str) -> None:
    with _login_lock:
        _login_tries.pop(username_lower, None)


# Genel hız sınırı (bellek içi): {(kova, anahtar): [zaman damgaları]}
_rate_buckets = {}
_rate_lock = threading.Lock()


def rate_ok(bucket: str, key, max_n: int, window: int) -> bool:
    """Pencere içinde en fazla max_n işleme izin verir. Kova başına ayrı sayaç."""
    now = time.time()
    k = (bucket, key)
    with _rate_lock:
        times = [t for t in _rate_buckets.get(k, []) if now - t < window]
        if len(times) >= max_n:
            _rate_buckets[k] = times
            return False
        times.append(now)
        _rate_buckets[k] = times
        return True


def submit_allowed(user_id: int) -> bool:
    """Skor gönderimi (ödül yolu): kullanıcı başına dakikada SUBMIT_MAX."""
    return rate_ok("submit", user_id, SUBMIT_MAX, SUBMIT_WINDOW)


def flag_submission(conn, me, endpoint, reason, claimed, computed, moves, seed):
    """Şüpheli/geçersiz gönderimi inceleme için kaydeder."""
    try:
        conn.execute(
            "INSERT INTO flagged_submissions "
            "(user_id, username, endpoint, reason, claimed_score, computed_score, "
            "moves, seed, created) VALUES (?,?,?,?,?,?,?,?,?)",
            (me["id"], me["username"], endpoint, reason, claimed, computed,
             moves, seed, int(time.time())),
        )
        conn.commit()
    except Exception:
        traceback.print_exc()


def verify_transcript(b):
    """
    Gönderilen transkripti (tohum + hamleler) doğrular ve SUNUCUNUN
    hesapladığı skoru döndürür.

    Dönen: (ok, score, best, info)
      ok=False ise info bir hata sebebi ('invalid_replay' vb.).
      ok=True ise score/best sunucu-hesaplı GÜVENİLİR değerlerdir.
    """
    seed = int(b.get("seed") or 0) & 0xFFFFFFFF
    moves = b.get("moves")
    size = int(b.get("size") or 4)

    if not isinstance(moves, str):
        return False, 0, 0, "missing_transcript"
    if size not in VALID_SIZES:
        return False, 0, 0, "bad_size"
    if len(moves) > MAX_MOVES:
        return False, 0, 0, "too_long"

    result = replay_game(seed, moves, size)
    if not result["valid"]:
        # Bozuk/sahte transkript: bir hamle tahtayı değiştirmiyor veya
        # geçersiz karakter → replay skoru güvenilmez.
        return False, 0, 0, "invalid_replay"

    return True, result["score"], result["maxTile"], "ok"


# --------------------------------------------------------------------------
#  Veritabanı
# --------------------------------------------------------------------------
_wal_ready = False


def db():
    # timeout: eşzamanlı yazmalarda "database is locked" yerine bekle.
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    # journal_mode kalıcı bir ayardır; her istekte çalıştırmak gereksiz
    # kilit alır (oda yoklaması saniyede birkaç istek gönderiyor).
    global _wal_ready
    if not _wal_ready:
        conn.execute("PRAGMA journal_mode=WAL")
        _wal_ready = True
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


def init_db():
    conn = db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            username_lower TEXT UNIQUE NOT NULL,
            pwhash TEXT NOT NULL,
            salt TEXT NOT NULL,
            data TEXT NOT NULL DEFAULT '{}',
            created INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created INTEGER NOT NULL
        );
        -- Sonraki fazlar için hazır tablolar:
        CREATE TABLE IF NOT EXISTS friendships (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            requester_id INTEGER NOT NULL,
            addressee_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted
            created INTEGER NOT NULL,
            UNIQUE(requester_id, addressee_id)
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_id INTEGER NOT NULL,
            to_id INTEGER NOT NULL,
            body TEXT NOT NULL,
            created INTEGER NOT NULL
        );
        -- Çok oyunculu: yarış odaları
        CREATE TABLE IF NOT EXISTS rooms (
            code TEXT PRIMARY KEY,
            host_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'lobby',  -- lobby | racing | finished
            seed INTEGER NOT NULL,
            duration INTEGER NOT NULL DEFAULT 180,
            started_at INTEGER,
            created INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS room_players (
            code TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            score INTEGER NOT NULL DEFAULT 0,
            best INTEGER NOT NULL DEFAULT 0,
            done INTEGER NOT NULL DEFAULT 0,
            joined INTEGER NOT NULL,
            UNIQUE(code, user_id)
        );
        -- Günlük meydan okuma: her gün herkes AYNI tahtayı oynar (tohum
        -- tarihten türetilir). Kullanıcı başına o günün EN İYİ skoru tutulur.
        -- Aylık skor tablosu: her ay YENİDEN başlar (yarış sıfırlanır),
        -- ama oyuncunun kendi ilerlemesi/rekoru ASLA sıfırlanmaz.
        CREATE TABLE IF NOT EXISTS monthly_scores (
            month TEXT NOT NULL,            -- YYYY-MM (UTC)
            user_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            score INTEGER NOT NULL DEFAULT 0,   -- o ay yapılan EN İYİ skor
            best INTEGER NOT NULL DEFAULT 0,    -- o ay yapılan en büyük kare
            updated INTEGER NOT NULL,
            PRIMARY KEY (month, user_id)
        );
        -- Ay sonunda 1. olan oyuncunun ödülü (ay başına tek kazanan).
        CREATE TABLE IF NOT EXISTS monthly_prizes (
            month TEXT PRIMARY KEY,         -- ödülün ait olduğu ay
            user_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            score INTEGER NOT NULL,
            claimed INTEGER NOT NULL DEFAULT 0,
            created INTEGER NOT NULL
        );
        -- Şüpheli/redddedilen skor gönderimleri (inceleme için).
        -- Doğrudan reddetmek yerine önce GÖZLEMLE: reddedilen ya da akla
        -- yatkınlık denetimine takılan gönderimler buraya yazılır.
        CREATE TABLE IF NOT EXISTS flagged_submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            endpoint TEXT NOT NULL,        -- monthly | daily
            reason TEXT NOT NULL,          -- invalid_replay | claimed_mismatch | ...
            claimed_score INTEGER,         -- istemcinin iddia ettiği (varsa)
            computed_score INTEGER,        -- sunucunun replay ile bulduğu
            moves INTEGER,                 -- transkript uzunluğu
            seed INTEGER,
            created INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS daily_scores (
            day TEXT NOT NULL,              -- YYYY-MM-DD (UTC)
            user_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            score INTEGER NOT NULL DEFAULT 0,
            best INTEGER NOT NULL DEFAULT 0,
            moves INTEGER NOT NULL DEFAULT 0,
            updated INTEGER NOT NULL,
            PRIMARY KEY (day, user_id)
        );
        """
    )
    # Şema göçü: users.email kolonu (eski DB'de yoksa ekle)
    try:
        conn.execute("ALTER TABLE users ADD COLUMN email TEXT")
    except Exception:
        pass  # zaten var
    conn.commit()
    conn.close()


# --------------------------------------------------------------------------
#  Yardımcılar
# --------------------------------------------------------------------------
def hash_pw(password: str, salt: str, iters: int = PBKDF2_ITERS) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), iters
    ).hex()


def check_pw(conn, row, password: str) -> bool:
    """Parolayı sabit zamanlı doğrular; eski turlu hash'i sessizce yükseltir.

    Tur sayısı 120k'dan 600k'ya çıkarıldı. Mevcut hesaplar kilitlenmesin
    diye eski tur sayısı da denenir ve doğruysa kayıt yenilenir.
    """
    salt = row["salt"]
    if secrets.compare_digest(row["pwhash"], hash_pw(password, salt)):
        return True
    if secrets.compare_digest(row["pwhash"], hash_pw(password, salt, LEGACY_ITERS)):
        conn.execute(
            "UPDATE users SET pwhash = ? WHERE id = ?",
            (hash_pw(password, salt), row["id"]),
        )
        conn.commit()
        return True
    return False


def user_public(row) -> dict:
    return {"id": row["id"], "username": row["username"], "created": row["created"]}


def friend_public(row) -> dict:
    """Arkadaş listesi için: kimlik + oyun verisinden birkaç özet alan."""
    try:
        data = json.loads(row["data"] or "{}")
    except Exception:
        data = {}
    return {
        "id": row["id"],
        "username": row["username"],
        "bestScore": int(data.get("bestScore") or 0),
        "bestLevel": int(data.get("bestLevel") or 1),
        "bestTile": int(data.get("bestTile") or 0),
    }


def leaderboard_rows(conn, user_ids=None, limit: int = 50):
    """En yüksek skora göre sıralı oyuncu listesi.

    Skor `users.data` JSON'unun içinde tutulduğundan SQL ile sıralanamaz;
    satırlar okunup Python'da sıralanır. Kullanıcı sayısı bu ölçekte küçük
    olduğu için yeterli (gerekirse ileride ayrı bir sütuna taşınabilir).
    """
    if user_ids is not None:
        if not user_ids:
            return []
        marks = ",".join("?" for _ in user_ids)
        rows = conn.execute(
            f"SELECT id, username, data FROM users WHERE id IN ({marks})",
            tuple(user_ids),
        ).fetchall()
    else:
        rows = conn.execute("SELECT id, username, data FROM users").fetchall()

    people = [friend_public(r) for r in rows]
    people.sort(
        key=lambda p: (-p["bestScore"], -p["bestTile"], p["username"].lower())
    )
    top = people[:limit]
    for i, p in enumerate(top):
        p["rank"] = i + 1
    return top


def utc_day() -> str:
    """Bugünün gün anahtarı (UTC) — herkes aynı günde aynı tahtayı oynar."""
    return time.strftime("%Y-%m-%d", time.gmtime())


def utc_month() -> str:
    """İçinde bulunulan ay (UTC) — `YYYY-MM`."""
    return time.strftime("%Y-%m", time.gmtime())


def prev_month(month: str) -> str:
    """Verilen aydan bir önceki ay (`YYYY-MM`)."""
    y, m = (int(x) for x in month.split("-"))
    if m == 1:
        return f"{y - 1}-12"
    return f"{y}-{m - 1:02d}"


def settle_finished_months(conn) -> None:
    """Biten ayların şampiyonunu belirler (tembel değerlendirme).

    Ay değiştiğinde, henüz kazananı yazılmamış geçmiş aylar için
    o ayın 1.'si `monthly_prizes` tablosuna kaydedilir. Zamanlanmış
    görev gerektirmez: tabloyu ilk isteyen tetikler.
    """
    now_month = utc_month()
    rows = conn.execute(
        "SELECT DISTINCT month FROM monthly_scores WHERE month < ?", (now_month,)
    ).fetchall()
    for r in rows:
        month = r["month"]
        exists = conn.execute(
            "SELECT 1 FROM monthly_prizes WHERE month = ?", (month,)
        ).fetchone()
        if exists:
            continue
        top = conn.execute(
            "SELECT user_id, username, score FROM monthly_scores "
            "WHERE month = ? AND score > 0 ORDER BY score DESC, updated ASC LIMIT 1",
            (month,),
        ).fetchone()
        if not top:
            continue
        conn.execute(
            "INSERT OR IGNORE INTO monthly_prizes "
            "(month, user_id, username, score, claimed, created) VALUES (?,?,?,?,0,?)",
            (month, top["user_id"], top["username"], top["score"], int(time.time())),
        )
    conn.commit()


def daily_seed(day: str) -> int:
    """Gün anahtarından kararlı bir tohum üretir (istemciyle aynı formül).

    Basit FNV-benzeri karma: aynı gün → aynı tohum, ardışık günler
    birbirine benzemeyen tahtalar verir.
    """
    h = 2166136261
    for ch in day:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h or 1


def make_token(conn, user_id: int) -> str:
    token = secrets.token_hex(32)
    conn.execute(
        "INSERT INTO sessions (token, user_id, created) VALUES (?,?,?)",
        (token, user_id, int(time.time())),
    )
    conn.commit()
    return token


def user_from_token(conn, token: str):
    if not token:
        return None
    # TOKEN_TTL artık gerçekten uygulanıyor: eskiden sessions.created hiç
    # okunmadığı için sızan bir jeton sonsuza dek geçerli kalıyordu.
    cutoff = int(time.time()) - TOKEN_TTL
    row = conn.execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token = ? AND s.created > ?",
        (token, cutoff),
    ).fetchone()
    if row is None:
        # Süresi dolmuş oturumları fırsat buldukça temizle.
        conn.execute("DELETE FROM sessions WHERE created <= ?", (cutoff,))
        conn.commit()
    return row


def are_friends(conn, a: int, b: int) -> bool:
    row = conn.execute(
        "SELECT 1 FROM friendships WHERE status='accepted' AND "
        "((requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?))",
        (a, b, b, a),
    ).fetchone()
    return row is not None


# Oda kodunda karışması kolay karakterler yok (0/O, 1/I)
ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def reap_stale_rooms(conn) -> None:
    """6 saatten eski odaları siler.

    Host tarayıcısı `leave` göndermeden kapanırsa oda satırları sonsuza
    dek kalıyordu; bu hem 4 karakterlik kod havuzunu hem de veritabanını
    zamanla dolduruyor.
    """
    cutoff = int(time.time()) - 6 * 3600
    conn.execute(
        "DELETE FROM room_players WHERE code IN "
        "(SELECT code FROM rooms WHERE created < ?)",
        (cutoff,),
    )
    conn.execute("DELETE FROM rooms WHERE created < ?", (cutoff,))
    conn.commit()


def gen_room_code(conn) -> str:
    for _ in range(50):
        code = "".join(secrets.choice(ROOM_ALPHABET) for _ in range(4))
        if not conn.execute("SELECT 1 FROM rooms WHERE code=?", (code,)).fetchone():
            return code
    return "".join(secrets.choice(ROOM_ALPHABET) for _ in range(6))


def room_state(conn, code):
    room = conn.execute("SELECT * FROM rooms WHERE code=?", (code,)).fetchone()
    if not room:
        return None
    now = int(time.time())
    status = room["status"]
    # Süre dolduysa tembel bitir
    if status == "racing" and room["started_at"] and now >= room["started_at"] + room["duration"]:
        conn.execute("UPDATE rooms SET status='finished' WHERE code=?", (code,))
        conn.commit()
        status = "finished"
    players = conn.execute(
        "SELECT user_id, username, score, best, done FROM room_players "
        "WHERE code=? ORDER BY score DESC, best DESC, username ASC",
        (code,),
    ).fetchall()
    return {
        "code": room["code"],
        "hostId": room["host_id"],
        "status": status,
        "seed": room["seed"],
        "duration": room["duration"],
        "startedAt": room["started_at"],
        "now": now,
        "players": [
            {
                "id": p["user_id"],
                "username": p["username"],
                "score": p["score"],
                "best": p["best"],
                "done": bool(p["done"]),
                "isBot": p["user_id"] < 0,  # botlar negatif kimlikli
            }
            for p in players
        ],
    }


# --------------------------------------------------------------------------
#  HTTP
# --------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = "game2048-api/1.0"

    def _send(self, code: int, obj):
        # 204 gövde taşıyamaz (RFC 9110); nginx ve katı istemciler reddedebilir.
        body = b"" if code == 204 else json.dumps(obj).encode("utf-8")
        self.send_response(code)
        if body:
            self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # Yerel geliştirme için CORS (prodda aynı origin)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _body(self) -> dict:
        raw = self.headers.get("Content-Length", 0) or 0
        try:
            length = int(raw)
        except (TypeError, ValueError):
            raise BadRequest("bad_content_length")
        if length <= 0:
            return {}
        # Sınırsız okuma bellek tüketimiyle sunucuyu düşürebiliyordu.
        if length > MAX_BODY:
            raise BadRequest("payload_too_large")
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return {}
        return data if isinstance(data, dict) else {}

    def _token(self):
        auth = self.headers.get("Authorization", "")
        return auth[7:].strip() if auth.startswith("Bearer ") else None

    def _path(self):
        # /emre/2048/api/... veya /... (nginx proxy sonrası)
        p = self.path.split("?")[0]
        for prefix in ("/emre/2048/api", "/api"):
            if p.startswith(prefix):
                p = p[len(prefix):]
                break  # tek önek soyulur (/api/apix → /x olmasın)
        return p.rstrip("/") or "/"

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        self._dispatch(self._route_get)

    def do_POST(self):
        self._dispatch(self._route_post)

    def _dispatch(self, route):
        """Tüm hataları JSON yanıta çevirir.

        Önceden hiçbir işleyicide try/except yoktu: gövdedeki bozuk bir
        sayı (`{"id": "abc"}`) işleyiciyi çökertiyor, istemciye yanıt hiç
        yazılmadığı için bağlantı resetleniyordu.
        """
        try:
            route()
        except BadRequest as exc:
            self._send(400, {"error": str(exc)})
        except (ValueError, TypeError, KeyError, IndexError):
            self._send(400, {"error": "bad_request"})
        except sqlite3.IntegrityError:
            self._send(409, {"error": "conflict"})
        except sqlite3.OperationalError:
            self._send(503, {"error": "busy"})
        except Exception:
            traceback.print_exc()  # ayrıntı yalnızca sunucu günlüğüne
            self._send(500, {"error": "server_error"})

    def _route_get(self):
        p = self._path()
        if p == "/health":
            return self._send(200, {"ok": True})
        if p == "/me":
            return self._me()
        if p == "/friends":
            return self._friends_list()
        if p == "/users/search":
            return self._users_search()
        if p == "/messages":
            return self._messages_list()
        if p == "/messages/overview":
            return self._messages_overview()
        if p == "/rooms/state":
            return self._room_state()
        if p == "/leaderboard":
            return self._leaderboard()
        if p == "/daily":
            return self._daily_info()
        return self._send(404, {"error": "not_found"})

    def _route_post(self):
        p = self._path()
        if p == "/register":
            return self._register()
        if p == "/login":
            return self._login()
        if p == "/logout":
            return self._logout()
        if p == "/sync":
            return self._sync()
        if p == "/friends/request":
            return self._friend_request()
        if p == "/friends/respond":
            return self._friend_respond()
        if p == "/friends/remove":
            return self._friend_remove()
        if p == "/messages":
            return self._message_send()
        if p == "/rooms/create":
            return self._room_create()
        if p == "/rooms/join":
            return self._room_join()
        if p == "/rooms/leave":
            return self._room_leave()
        if p == "/rooms/start":
            return self._room_start()
        if p == "/rooms/progress":
            return self._room_progress()
        if p == "/rooms/addbot":
            return self._room_addbot()
        if p == "/rooms/removebot":
            return self._room_removebot()
        if p == "/rooms/botprogress":
            return self._room_botprogress()
        if p == "/daily/submit":
            return self._daily_submit()
        if p == "/monthly/submit":
            return self._monthly_submit()
        if p == "/monthly/claim":
            return self._monthly_claim()
        return self._send(404, {"error": "not_found"})

    def _auth_row(self, conn):
        """Bearer token'dan kullanıcı satırı; yoksa None."""
        return user_from_token(conn, self._token())

    # --- Rotalar ---
    def _register(self):
        b = self._body()
        username = (b.get("username") or "").strip()
        password = b.get("password") or ""
        email = (b.get("email") or "").strip()
        if not USERNAME_RE.match(username):
            return self._send(400, {"error": "invalid_username"})
        if not EMAIL_RE.match(email):
            return self._send(400, {"error": "invalid_email"})
        if len(password) < 6:
            return self._send(400, {"error": "weak_password"})

        conn = db()
        try:
            exists = conn.execute(
                "SELECT 1 FROM users WHERE username_lower = ?", (username.lower(),)
            ).fetchone()
            if exists:
                return self._send(409, {"error": "username_taken"})

            salt = secrets.token_hex(16)
            data = json.dumps(b.get("data") or {})
            if len(data) > MAX_DATA:
                return self._send(400, {"error": "invalid_data"})
            try:
                conn.execute(
                    "INSERT INTO users (username, username_lower, email, pwhash, salt, data, created)"
                    " VALUES (?,?,?,?,?,?,?)",
                    (username, username.lower(), email, hash_pw(password, salt), salt, data, int(time.time())),
                )
            except sqlite3.IntegrityError:
                # İki eşzamanlı kayıt: kontrol ile INSERT arası yarış.
                return self._send(409, {"error": "username_taken"})
            conn.commit()
            row = conn.execute(
                "SELECT * FROM users WHERE username_lower = ?", (username.lower(),)
            ).fetchone()
            token = make_token(conn, row["id"])
            return self._send(200, {"token": token, "user": user_public(row)})
        finally:
            conn.close()

    def _login(self):
        b = self._body()
        username = (b.get("username") or "").strip()
        password = b.get("password") or ""
        uname = username.lower()
        # Kaba kuvvete karşı: aynı kullanıcı adına 2 dakikada 10 deneme.
        if not login_allowed(uname):
            return self._send(429, {"error": "too_many_attempts"})
        conn = db()
        try:
            row = conn.execute(
                "SELECT * FROM users WHERE username_lower = ?", (uname,)
            ).fetchone()
            if not row or not check_pw(conn, row, password):
                return self._send(401, {"error": "bad_credentials"})
            login_succeeded(uname)
            token = make_token(conn, row["id"])
            return self._send(200, {"token": token, "user": user_public(row)})
        finally:
            conn.close()

    def _logout(self):
        token = self._token()
        if not token:
            # Eskiden jeton yokken de 200 dönüyordu (hiçbir şey yapmadan).
            return self._send(401, {"error": "unauthorized"})
        conn = db()
        try:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            conn.commit()
            return self._send(200, {"ok": True})
        finally:
            conn.close()

    def _me(self):
        conn = db()
        try:
            row = user_from_token(conn, self._token())
            if not row:
                return self._send(401, {"error": "unauthorized"})
            try:
                data = json.loads(row["data"] or "{}")
            except Exception:
                data = {}
            return self._send(200, {"user": user_public(row), "data": data})
        finally:
            conn.close()

    def _sync(self):
        conn = db()
        try:
            row = user_from_token(conn, self._token())
            if not row:
                return self._send(401, {"error": "unauthorized"})
            data = self._body().get("data")
            if not isinstance(data, dict):
                return self._send(400, {"error": "invalid_data"})
            blob = json.dumps(data)
            # Sınırsız blob ile veritabanını şişirmeyi engelle.
            if len(blob) > MAX_DATA:
                return self._send(400, {"error": "invalid_data"})
            conn.execute(
                "UPDATE users SET data = ? WHERE id = ?",
                (blob, row["id"]),
            )
            conn.commit()
            return self._send(200, {"ok": True})
        finally:
            conn.close()

    # --- Arkadaşlar --------------------------------------------
    def _users_search(self):
        """GET /users/search?q=  -> eşleşen kullanıcılar (kendisi hariç)."""
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            q = ""
            if "?" in self.path:
                from urllib.parse import parse_qs
                q = (parse_qs(self.path.split("?", 1)[1]).get("q", [""])[0]).strip()
            if len(q) < 2 or len(q) > 20:
                return self._send(200, {"users": []})
            # LIKE joker karakterleri kaçırılır: "q=__" ile tüm kullanıcı
            # tablosunu dökmek mümkündü (numaralandırma).
            pattern = (
                q.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            )
            rows = conn.execute(
                "SELECT * FROM users WHERE username_lower LIKE ? ESCAPE '\\' "
                "AND id != ? ORDER BY username LIMIT 15",
                (f"%{pattern}%", me["id"]),
            ).fetchall()
            return self._send(200, {"users": [user_public(r) for r in rows]})
        finally:
            conn.close()

    def _friend_request(self):
        """POST /friends/request {username|id} -> istek gönder (ya da karşılıklıysa kabul)."""
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            b = self._body()
            target = None
            if b.get("id"):
                target = conn.execute(
                    "SELECT * FROM users WHERE id = ?", (int(b["id"]),)
                ).fetchone()
            elif b.get("username"):
                target = conn.execute(
                    "SELECT * FROM users WHERE username_lower = ?",
                    (str(b["username"]).strip().lower(),),
                ).fetchone()
            if not target:
                return self._send(404, {"error": "user_not_found"})
            if target["id"] == me["id"]:
                return self._send(400, {"error": "cannot_add_self"})

            # Zaten bir ilişki var mı? (her iki yön)
            existing = conn.execute(
                "SELECT * FROM friendships WHERE "
                "(requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)",
                (me["id"], target["id"], target["id"], me["id"]),
            ).fetchone()
            if existing:
                if existing["status"] == "accepted":
                    return self._send(409, {"error": "already_friends"})
                # Karşı taraf zaten bana istek attıysa -> kabul et
                if existing["requester_id"] == target["id"]:
                    conn.execute(
                        "UPDATE friendships SET status='accepted' WHERE id=?",
                        (existing["id"],),
                    )
                    conn.commit()
                    return self._send(200, {"ok": True, "status": "accepted"})
                return self._send(409, {"error": "already_requested"})

            conn.execute(
                "INSERT INTO friendships (requester_id, addressee_id, status, created) "
                "VALUES (?,?,'pending',?)",
                (me["id"], target["id"], int(time.time())),
            )
            conn.commit()
            return self._send(200, {"ok": True, "status": "pending"})
        finally:
            conn.close()

    def _friend_respond(self):
        """POST /friends/respond {id, accept:bool} -> gelen isteği kabul/ret."""
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            b = self._body()
            fid = b.get("id")
            accept = bool(b.get("accept"))
            row = conn.execute(
                "SELECT * FROM friendships WHERE id=? AND addressee_id=? AND status='pending'",
                (int(fid) if fid else 0, me["id"]),
            ).fetchone()
            if not row:
                return self._send(404, {"error": "request_not_found"})
            if accept:
                conn.execute(
                    "UPDATE friendships SET status='accepted' WHERE id=?", (row["id"],)
                )
            else:
                conn.execute("DELETE FROM friendships WHERE id=?", (row["id"],))
            conn.commit()
            return self._send(200, {"ok": True})
        finally:
            conn.close()

    def _friend_remove(self):
        """POST /friends/remove {id:userId} -> arkadaşlıktan çıkar (her iki yön)."""
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            other = self._body().get("id")
            if not other:
                return self._send(400, {"error": "missing_id"})
            conn.execute(
                "DELETE FROM friendships WHERE "
                "(requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)",
                (me["id"], int(other), int(other), me["id"]),
            )
            conn.commit()
            return self._send(200, {"ok": True})
        finally:
            conn.close()

    def _friends_list(self):
        """GET /friends -> {friends:[], incoming:[], outgoing:[]}."""
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            mid = me["id"]

            # Kabul edilmiş arkadaşlar (her iki yönden karşı taraf)
            friends = conn.execute(
                "SELECT u.* FROM friendships f "
                "JOIN users u ON u.id = CASE WHEN f.requester_id=? THEN f.addressee_id ELSE f.requester_id END "
                "WHERE f.status='accepted' AND (f.requester_id=? OR f.addressee_id=?) "
                "ORDER BY u.username",
                (mid, mid, mid),
            ).fetchall()

            # Gelen istekler (ben addressee, pending) — friendship.id gerekir (yanıt için)
            incoming = conn.execute(
                "SELECT f.id AS req_id, u.* FROM friendships f "
                "JOIN users u ON u.id = f.requester_id "
                "WHERE f.status='pending' AND f.addressee_id=? ORDER BY f.created DESC",
                (mid,),
            ).fetchall()

            # Giden istekler (ben requester, pending)
            outgoing = conn.execute(
                "SELECT f.id AS req_id, u.* FROM friendships f "
                "JOIN users u ON u.id = f.addressee_id "
                "WHERE f.status='pending' AND f.requester_id=? ORDER BY f.created DESC",
                (mid,),
            ).fetchall()

            def with_req(rows):
                out = []
                for r in rows:
                    fp = friend_public(r)
                    fp["reqId"] = r["req_id"]
                    out.append(fp)
                return out

            return self._send(200, {
                "friends": [friend_public(r) for r in friends],
                "incoming": with_req(incoming),
                "outgoing": with_req(outgoing),
            })
        finally:
            conn.close()

    # --- Sohbet ------------------------------------------------
    def _query(self, key, default=""):
        if "?" not in self.path:
            return default
        from urllib.parse import parse_qs
        return parse_qs(self.path.split("?", 1)[1]).get(key, [default])[0]

    def _message_send(self):
        """POST /messages {to, body} -> arkadaşa mesaj gönder."""
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            b = self._body()
            to = b.get("to")
            body = (b.get("body") or "").strip()
            if not to:
                return self._send(400, {"error": "missing_to"})
            if not body:
                return self._send(400, {"error": "empty_message"})
            if len(body) > 500:
                body = body[:500]
            if not are_friends(conn, me["id"], int(to)):
                return self._send(403, {"error": "not_friends"})
            now = int(time.time())
            cur = conn.execute(
                "INSERT INTO messages (from_id, to_id, body, created) VALUES (?,?,?,?)",
                (me["id"], int(to), body, now),
            )
            conn.commit()
            return self._send(200, {
                "ok": True,
                "message": {
                    "id": cur.lastrowid,
                    "from_id": me["id"],
                    "to_id": int(to),
                    "body": body,
                    "created": now,
                },
            })
        finally:
            conn.close()

    def _messages_list(self):
        """GET /messages?with=<userId>&after=<msgId> -> iki kişi arası mesajlar."""
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            other = self._query("with")
            after = self._query("after", "0")
            if not other:
                return self._send(400, {"error": "missing_with"})
            other = int(other)
            after = int(after) if str(after).isdigit() else 0
            rows = conn.execute(
                "SELECT id, from_id, to_id, body, created FROM messages "
                "WHERE id > ? AND ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?)) "
                "ORDER BY id ASC LIMIT 200",
                (after, me["id"], other, other, me["id"]),
            ).fetchall()
            return self._send(200, {"messages": [dict(r) for r in rows]})
        finally:
            conn.close()

    def _messages_overview(self):
        """GET /messages/overview -> her sohbet için en son mesaj kimliği (okunmadı rozeti)."""
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            mid = me["id"]
            # Her karşı taraf için son mesaj id'si + son mesajı kimin yazdığı
            rows = conn.execute(
                "SELECT CASE WHEN from_id=? THEN to_id ELSE from_id END AS other, "
                "MAX(id) AS last_id "
                "FROM messages WHERE from_id=? OR to_id=? GROUP BY other",
                (mid, mid, mid),
            ).fetchall()
            out = []
            for r in rows:
                last = conn.execute(
                    "SELECT id, from_id, body, created FROM messages WHERE id=?",
                    (r["last_id"],),
                ).fetchone()
                out.append({
                    "other": r["other"],
                    "lastId": r["last_id"],
                    "lastFrom": last["from_id"],
                    "lastBody": last["body"],
                    "lastCreated": last["created"],
                })
            return self._send(200, {"conversations": out})
        finally:
            conn.close()

    # --- Çok oyunculu (yarış odaları) --------------------------
    def _room_create(self):
        """POST /rooms/create {duration?} -> yeni oda (host = ben)."""
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            b = self._body()
            duration = int(b.get("duration") or 180)
            duration = max(30, min(600, duration))
            reap_stale_rooms(conn)  # terk edilmiş odaları temizle
            code = gen_room_code(conn)
            seed = secrets.randbelow(2_000_000_000) + 1
            now = int(time.time())
            conn.execute(
                "INSERT INTO rooms (code, host_id, status, seed, duration, created) "
                "VALUES (?,?,'lobby',?,?,?)",
                (code, me["id"], seed, duration, now),
            )
            conn.execute(
                "INSERT INTO room_players (code, user_id, username, joined) VALUES (?,?,?,?)",
                (code, me["id"], me["username"], now),
            )
            conn.commit()
            return self._send(200, {"room": room_state(conn, code)})
        finally:
            conn.close()

    def _room_join(self):
        """POST /rooms/join {code} -> odaya katıl (lobide ise)."""
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            code = (self._body().get("code") or "").strip().upper()
            room = conn.execute("SELECT * FROM rooms WHERE code=?", (code,)).fetchone()
            if not room:
                return self._send(404, {"error": "room_not_found"})
            if room["status"] != "lobby":
                return self._send(409, {"error": "already_started"})
            conn.execute(
                "INSERT OR IGNORE INTO room_players (code, user_id, username, joined) "
                "VALUES (?,?,?,?)",
                (code, me["id"], me["username"], int(time.time())),
            )
            conn.commit()
            return self._send(200, {"room": room_state(conn, code)})
        finally:
            conn.close()

    def _room_leave(self):
        """POST /rooms/leave {code} -> odadan ayrıl (host ayrılırsa oda kapanır)."""
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            code = (self._body().get("code") or "").strip().upper()
            room = conn.execute("SELECT * FROM rooms WHERE code=?", (code,)).fetchone()
            if not room:
                return self._send(200, {"ok": True})
            if room["host_id"] == me["id"]:
                # Host ayrıldı. Eskiden oda koşulsuz siliniyordu; yarışın
                # ortasında host sekmeyi kapatınca diğer herkesin yarışı
                # buharlaşıyordu. Başka insan oyuncu varsa kurucu devredilir.
                conn.execute(
                    "DELETE FROM room_players WHERE code=? AND user_id=?",
                    (code, me["id"]),
                )
                heir = conn.execute(
                    "SELECT user_id FROM room_players WHERE code=? AND user_id>0 "
                    "ORDER BY joined LIMIT 1",
                    (code,),
                ).fetchone()
                if heir:
                    conn.execute(
                        "UPDATE rooms SET host_id=? WHERE code=?", (heir["user_id"], code)
                    )
                else:
                    # İnsan kalmadı → odayı (ve botlarını) kaldır
                    conn.execute("DELETE FROM room_players WHERE code=?", (code,))
                    conn.execute("DELETE FROM rooms WHERE code=?", (code,))
            else:
                conn.execute(
                    "DELETE FROM room_players WHERE code=? AND user_id=?",
                    (code, me["id"]),
                )
            conn.commit()
            return self._send(200, {"ok": True})
        finally:
            conn.close()

    def _room_start(self):
        """POST /rooms/start {code} -> yarışı başlat (yalnızca host)."""
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            code = (self._body().get("code") or "").strip().upper()
            room = conn.execute("SELECT * FROM rooms WHERE code=?", (code,)).fetchone()
            if not room:
                return self._send(404, {"error": "room_not_found"})
            if room["host_id"] != me["id"]:
                return self._send(403, {"error": "not_host"})
            if room["status"] != "lobby":
                return self._send(409, {"error": "already_started"})
            now = int(time.time())
            conn.execute(
                "UPDATE rooms SET status='racing', started_at=? WHERE code=?",
                (now, code),
            )
            # Skorları sıfırla (lobide birikmiş olmasın)
            conn.execute(
                "UPDATE room_players SET score=0, best=0, done=0 WHERE code=?", (code,)
            )
            conn.commit()
            return self._send(200, {"room": room_state(conn, code)})
        finally:
            conn.close()

    def _room_progress(self):
        """POST /rooms/progress {code, score, best, done} -> ilerlememi bildir."""
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            # Canlı yoklama ~1.2sn: cömert sınır (spam/DoS'a karşı).
            if not rate_ok("room", me["id"], 180, 60):
                return self._send(429, {"error": "too_many_requests"})
            b = self._body()
            code = (b.get("code") or "").strip().upper()
            score = int(b.get("score") or 0)
            best = int(b.get("best") or 0)
            done = 1 if b.get("done") else 0
            # Skorlar tamamen istemciden geliyordu: negatif/uçuk değerler ve
            # yarış bittikten SONRA gönderilen güncellemeler kabul ediliyordu.
            if not 0 <= score <= MAX_SCORE or not 0 <= best <= MAX_SCORE:
                return self._send(400, {"error": "invalid_score"})
            room = conn.execute("SELECT * FROM rooms WHERE code=?", (code,)).fetchone()
            if not room:
                return self._send(404, {"error": "room_not_found"})
            member = conn.execute(
                "SELECT 1 FROM room_players WHERE code=? AND user_id=?",
                (code, me["id"]),
            ).fetchone()
            if not member:
                return self._send(403, {"error": "not_in_room"})
            if room["status"] != "racing":
                # Lobide veya yarış bittikten sonra skor YAZILMAZ; ancak
                # istemci son durumu görebilsin diye oda yine döndürülür
                # (aksi hâlde yarışın bittiğini hiç öğrenemezdi).
                return self._send(200, {"room": room_state(conn, code)})
            conn.execute(
                "UPDATE room_players SET score=?, best=?, done=? WHERE code=? AND user_id=?",
                (score, best, done, code, me["id"]),
            )
            conn.commit()
            return self._send(200, {"room": room_state(conn, code)})
        finally:
            conn.close()

    # --- YZ botları (host tarafından yönetilir) ----------------
    def _room_addbot(self):
        """POST /rooms/addbot {code, difficulty} -> odaya YZ botu ekle (host, lobi)."""
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            b = self._body()
            code = (b.get("code") or "").strip().upper()
            diff = (b.get("difficulty") or "medium").lower()
            names = {"easy": "🤖 Bot (Kolay)", "medium": "🤖 Bot (Orta)", "expert": "🤖 Bot (Uzman)"}
            room = conn.execute("SELECT * FROM rooms WHERE code=?", (code,)).fetchone()
            if not room:
                return self._send(404, {"error": "room_not_found"})
            if room["host_id"] != me["id"]:
                return self._send(403, {"error": "not_host"})
            if room["status"] != "lobby":
                return self._send(409, {"error": "already_started"})
            # En küçük mevcut kimliğin altında yeni negatif bot kimliği
            row = conn.execute(
                "SELECT MIN(user_id) AS m FROM room_players WHERE code=?", (code,)
            ).fetchone()
            bot_id = min(0, row["m"] or 0) - 1
            try:
                conn.execute(
                    "INSERT INTO room_players (code, user_id, username, joined) VALUES (?,?,?,?)",
                    (code, bot_id, names.get(diff, names["medium"]), int(time.time())),
                )
            except sqlite3.IntegrityError:
                # Host butona iki kez bastıysa iki istek de aynı kimliği
                # hesaplayabilir; çakışmayı hata değil, "tekrar dene" say.
                return self._send(409, {"error": "try_again"})
            conn.commit()
            return self._send(200, {"room": room_state(conn, code), "botId": bot_id})
        finally:
            conn.close()

    def _room_removebot(self):
        """POST /rooms/removebot {code, botId} -> botu çıkar (host, lobi)."""
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            b = self._body()
            code = (b.get("code") or "").strip().upper()
            bot_id = b.get("botId")
            room = conn.execute("SELECT * FROM rooms WHERE code=?", (code,)).fetchone()
            if not room:
                return self._send(404, {"error": "room_not_found"})
            if room["host_id"] != me["id"]:
                return self._send(403, {"error": "not_host"})
            conn.execute(
                "DELETE FROM room_players WHERE code=? AND user_id=? AND user_id<0",
                (code, int(bot_id) if bot_id is not None else 0),
            )
            conn.commit()
            return self._send(200, {"room": room_state(conn, code)})
        finally:
            conn.close()

    def _room_botprogress(self):
        """POST /rooms/botprogress {code, botId, score, best, done} -> bot ilerlemesi (host)."""
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            b = self._body()
            code = (b.get("code") or "").strip().upper()
            bot_id = b.get("botId")
            room = conn.execute("SELECT * FROM rooms WHERE code=?", (code,)).fetchone()
            if not room:
                return self._send(404, {"error": "room_not_found"})
            if room["host_id"] != me["id"]:
                return self._send(403, {"error": "not_host"})
            if not rate_ok("room", me["id"], 300, 60):
                return self._send(429, {"error": "too_many_requests"})
            score = int(b.get("score") or 0)
            best = int(b.get("best") or 0)
            if not 0 <= score <= MAX_SCORE or not 0 <= best <= MAX_SCORE:
                return self._send(400, {"error": "invalid_score"})
            conn.execute(
                "UPDATE room_players SET score=?, best=?, done=? WHERE code=? AND user_id=? AND user_id<0",
                (
                    score,
                    best,
                    1 if b.get("done") else 0,
                    code,
                    int(bot_id) if bot_id is not None else 0,
                ),
            )
            conn.commit()
            return self._send(200, {"ok": True})
        finally:
            conn.close()

    def _leaderboard(self):
        """GET /leaderboard?scope=monthly|global|friends -> skor sıralaması.

        - `monthly`: yalnızca içinde bulunulan ayın skorları (her ay yeniden
          başlar; oyuncunun kendi rekoru/ilerlemesi sıfırlanmaz)
        - `global` : tüm zamanların en yüksek skoru
        - `friends`: yalnızca arkadaşlar (tüm zamanlar)

        Yanıt ayrıca çağıranın kendi sırasını (`me`) ve varsa bekleyen
        şampiyonluk ödülünü (`prize`) taşır.
        """
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            scope = (self._query("scope") or "monthly").lower()

            # Biten ayların şampiyonu belirlensin (tembel)
            settle_finished_months(conn)

            if scope == "monthly":
                month = utc_month()
                rows = conn.execute(
                    "SELECT user_id, username, score, best FROM monthly_scores "
                    "WHERE month = ? ORDER BY score DESC, best DESC, updated ASC LIMIT 50",
                    (month,),
                ).fetchall()
                top = [
                    {
                        "id": r["user_id"],
                        "username": r["username"],
                        "bestScore": r["score"],
                        "bestTile": r["best"],
                        "bestLevel": 0,
                        "rank": i + 1,
                    }
                    for i, r in enumerate(rows)
                ]
                mine = next((p for p in top if p["id"] == me["id"]), None)
                if mine is None:
                    own = conn.execute(
                        "SELECT score, best FROM monthly_scores WHERE month=? AND user_id=?",
                        (month, me["id"]),
                    ).fetchone()
                    if own:
                        rank = conn.execute(
                            "SELECT COUNT(*) AS n FROM monthly_scores "
                            "WHERE month=? AND score > ?",
                            (month, own["score"]),
                        ).fetchone()["n"] + 1
                        mine = {
                            "id": me["id"],
                            "username": me["username"],
                            "bestScore": own["score"],
                            "bestTile": own["best"],
                            "bestLevel": 0,
                            "rank": rank,
                        }
                return self._send(200, {
                    "scope": scope,
                    "month": month,
                    "top": top,
                    "me": mine,
                    "prize": self._pending_prize(conn, me),
                })

            if scope == "friends":
                # Arkadaşlar + kendim
                rows = conn.execute(
                    "SELECT CASE WHEN requester_id=? THEN addressee_id ELSE requester_id END AS other "
                    "FROM friendships WHERE status='accepted' AND (requester_id=? OR addressee_id=?)",
                    (me["id"], me["id"], me["id"]),
                ).fetchall()
                ids = [r["other"] for r in rows] + [me["id"]]
                top = leaderboard_rows(conn, user_ids=ids)
                mine = next((p for p in top if p["id"] == me["id"]), None)
            else:
                top = leaderboard_rows(conn)
                mine = next((p for p in top if p["id"] == me["id"]), None)
                if mine is None:
                    # İlk 50'de değilim → gerçek sıramı ayrıca hesapla
                    everyone = leaderboard_rows(conn, limit=10_000_000)
                    mine = next(
                        (p for p in everyone if p["id"] == me["id"]), None
                    )

            return self._send(200, {
                "scope": scope,
                "top": top,
                "me": mine,
                "prize": self._pending_prize(conn, me),
            })
        finally:
            conn.close()

    # --- Aylık şampiyonluk -------------------------------------

    def _pending_prize(self, conn, me):
        """Çağıranın alınmamış şampiyonluk ödülü varsa döndürür."""
        row = conn.execute(
            "SELECT month, score FROM monthly_prizes "
            "WHERE user_id = ? AND claimed = 0 ORDER BY month LIMIT 1",
            (me["id"],),
        ).fetchone()
        if not row:
            return None
        return {"month": row["month"], "score": row["score"], **CHAMPION_PRIZE}

    def _monthly_submit(self):
        """POST /monthly/submit {seed,moves,size} -> bu ayın skorunu bildir.

        Skor İSTEMCİDEN ALINMAZ: sunucu tohum+hamle dizisini yeniden
        oynatıp skoru KENDİSİ hesaplar. Böylece konsoldan uydurma skor
        gönderilemez. Ayın mevcut en iyisinden yüksekse güncellenir.
        """
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            if not submit_allowed(me["id"]):
                return self._send(429, {"error": "too_many_submissions"})

            b = self._body()
            claimed = int(b.get("score") or 0)  # yalnızca kayıt/kıyas için
            ok, score, best, info = verify_transcript(b)
            seed = int(b.get("seed") or 0) & 0xFFFFFFFF
            moves_len = len(b.get("moves") or "")

            if not ok:
                # Bozuk/sahte transkript → reddet + incelemeye kaydet
                flag_submission(conn, me, "monthly", info, claimed, None,
                                moves_len, seed)
                return self._send(400, {"error": "invalid_score"})

            # Akla yatkınlık: istemcinin iddiası sunucu skorundan ÇOK
            # saparsa (ör. eski/bozuk istemci) gözlem için işaretle —
            # ama sunucu skoru güvenilir olduğu için yine de kabul et.
            if claimed and abs(claimed - score) > max(50, score // 20):
                flag_submission(conn, me, "monthly", "claimed_mismatch",
                                claimed, score, moves_len, seed)

            month = utc_month()
            now = int(time.time())
            prev = conn.execute(
                "SELECT score FROM monthly_scores WHERE month=? AND user_id=?",
                (month, me["id"]),
            ).fetchone()
            improved = prev is None or score > prev["score"]
            if improved:
                conn.execute(
                    "INSERT INTO monthly_scores "
                    "(month, user_id, username, score, best, updated) VALUES (?,?,?,?,?,?) "
                    "ON CONFLICT(month, user_id) DO UPDATE SET "
                    "score=excluded.score, best=excluded.best, "
                    "username=excluded.username, updated=excluded.updated",
                    (month, me["id"], me["username"], score, best, now),
                )
                conn.commit()
            return self._send(200, {
                "ok": True, "improved": improved, "month": month, "score": score,
            })
        finally:
            conn.close()

    def _monthly_claim(self):
        """POST /monthly/claim -> bekleyen şampiyonluk ödülünü al.

        Ödül sunucuda 'alındı' işaretlenir; istemci altını/güçleri kendi
        tarafında ekler ve buluta senkronlar.
        """
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            settle_finished_months(conn)
            row = conn.execute(
                "SELECT month FROM monthly_prizes "
                "WHERE user_id = ? AND claimed = 0 ORDER BY month LIMIT 1",
                (me["id"],),
            ).fetchone()
            if not row:
                return self._send(404, {"error": "no_prize"})
            conn.execute(
                "UPDATE monthly_prizes SET claimed = 1 WHERE month = ? AND user_id = ?",
                (row["month"], me["id"]),
            )
            conn.commit()
            return self._send(200, {
                "ok": True,
                "month": row["month"],
                **CHAMPION_PRIZE,
            })
        finally:
            conn.close()

    # --- Günlük meydan okuma -----------------------------------
    def _daily_info(self):
        """GET /daily -> bugünün tohumu + sıralama + kendi sonucum."""
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            day = utc_day()
            rows = conn.execute(
                "SELECT user_id, username, score, best, moves FROM daily_scores "
                "WHERE day=? ORDER BY score DESC, best DESC, updated ASC LIMIT 50",
                (day,),
            ).fetchall()
            top = []
            for i, r in enumerate(rows):
                top.append({
                    "id": r["user_id"],
                    "username": r["username"],
                    "score": r["score"],
                    "best": r["best"],
                    "moves": r["moves"],
                    "rank": i + 1,
                })
            mine = next((x for x in top if x["id"] == me["id"]), None)
            if mine is None:
                own = conn.execute(
                    "SELECT score, best, moves FROM daily_scores WHERE day=? AND user_id=?",
                    (day, me["id"]),
                ).fetchone()
                if own:
                    rank = conn.execute(
                        "SELECT COUNT(*) AS n FROM daily_scores WHERE day=? AND score > ?",
                        (day, own["score"]),
                    ).fetchone()["n"] + 1
                    mine = {
                        "id": me["id"],
                        "username": me["username"],
                        "score": own["score"],
                        "best": own["best"],
                        "moves": own["moves"],
                        "rank": rank,
                    }
            return self._send(200, {
                "day": day,
                "seed": daily_seed(day),
                "top": top,
                "me": mine,
                "players": conn.execute(
                    "SELECT COUNT(*) AS n FROM daily_scores WHERE day=?", (day,)
                ).fetchone()["n"],
            })
        finally:
            conn.close()

    def _daily_submit(self):
        """POST /daily/submit {moves} -> günün sonucunu kaydet.

        Skor İSTEMCİDEN ALINMAZ: sunucu, GÜNÜN tohumunu (gün anahtarından)
        kendisi hesaplar ve hamle dizisini yeniden oynatır. Böylece oyuncu
        ne skoru uydurabilir ne de kolay bir tohum seçebilir.
        """
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            if not submit_allowed(me["id"]):
                return self._send(429, {"error": "too_many_submissions"})

            b = self._body()
            claimed = int(b.get("score") or 0)
            day = utc_day()
            moves_str = b.get("moves")
            if not isinstance(moves_str, str) or len(moves_str) > MAX_MOVES:
                flag_submission(conn, me, "daily", "missing_transcript",
                                claimed, None, 0, 0)
                return self._send(400, {"error": "invalid_score"})

            # GÜNÜN tohumu sunucudan; istemcinin gönderdiği tohum yok sayılır.
            seed = daily_seed(day)
            result = replay_game(seed, moves_str, 4)  # günlük her zaman 4×4
            if not result["valid"]:
                flag_submission(conn, me, "daily", "invalid_replay",
                                claimed, None, len(moves_str), seed)
                return self._send(400, {"error": "invalid_score"})

            score = result["score"]
            best = result["maxTile"]
            moves = result["moves"]
            if claimed and abs(claimed - score) > max(50, score // 20):
                flag_submission(conn, me, "daily", "claimed_mismatch",
                                claimed, score, moves, seed)

            now = int(time.time())
            prev = conn.execute(
                "SELECT score FROM daily_scores WHERE day=? AND user_id=?",
                (day, me["id"]),
            ).fetchone()
            improved = prev is None or score > prev["score"]
            if improved:
                conn.execute(
                    "INSERT INTO daily_scores (day, user_id, username, score, best, moves, updated) "
                    "VALUES (?,?,?,?,?,?,?) "
                    "ON CONFLICT(day, user_id) DO UPDATE SET "
                    "score=excluded.score, best=excluded.best, "
                    "moves=excluded.moves, username=excluded.username, updated=excluded.updated",
                    (day, me["id"], me["username"], score, best, moves, now),
                )
                conn.commit()
            return self._send(200, {"ok": True, "improved": improved, "day": day})
        finally:
            conn.close()

    def _room_state(self):
        """GET /rooms/state?code=XXX -> oda durumu (oyuncular skora göre sıralı)."""
        conn = db()
        try:
            me = self._auth_row(conn)
            if not me:
                return self._send(401, {"error": "unauthorized"})
            code = (self._query("code") or "").strip().upper()
            st = room_state(conn, code)
            if not st:
                return self._send(404, {"error": "room_not_found"})
            # Üyelik şartı: oda kodu 4 karakter (~1M olasılık), taranabilir.
            # Kontrol olmadan herkes her odanın TOHUMUNU ve skorlarını
            # okuyabiliyordu; tohum bilinince taş dizisi önceden hesaplanır.
            member = conn.execute(
                "SELECT 1 FROM room_players WHERE code=? AND user_id=?",
                (code, me["id"]),
            ).fetchone()
            if not member:
                return self._send(403, {"error": "not_in_room"})
            return self._send(200, {"room": st})
        finally:
            conn.close()

    def log_message(self, *args):
        pass  # sessiz


def main():
    init_db()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"game2048-api listening on 127.0.0.1:{PORT}, db={DB_PATH}")
    server.serve_forever()


if __name__ == "__main__":
    main()
