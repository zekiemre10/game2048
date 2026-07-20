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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DB_PATH = os.environ.get("GAME2048_DB", os.path.join(os.path.dirname(__file__), "app.db"))
PORT = int(os.environ.get("GAME2048_PORT", "8092"))

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.\-çğışöüÇĞİŞÖÜ ]{2,20}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PBKDF2_ITERS = 120_000
TOKEN_TTL = 60 * 60 * 24 * 90  # 90 gün


# --------------------------------------------------------------------------
#  Veritabanı
# --------------------------------------------------------------------------
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
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
def hash_pw(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ITERS
    ).hex()


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
    row = conn.execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?",
        (token,),
    ).fetchone()
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
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # Yerel geliştirme için CORS (prodda aynı origin)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return {}

    def _token(self):
        auth = self.headers.get("Authorization", "")
        return auth[7:].strip() if auth.startswith("Bearer ") else None

    def _path(self):
        # /emre/2048/api/... veya /... (nginx proxy sonrası)
        p = self.path.split("?")[0]
        for prefix in ("/emre/2048/api", "/api"):
            if p.startswith(prefix):
                p = p[len(prefix):]
        return p.rstrip("/") or "/"

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
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
        return self._send(404, {"error": "not_found"})

    def do_POST(self):
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
        if len(password) < 4:
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
            conn.execute(
                "INSERT INTO users (username, username_lower, email, pwhash, salt, data, created)"
                " VALUES (?,?,?,?,?,?,?)",
                (username, username.lower(), email, hash_pw(password, salt), salt, data, int(time.time())),
            )
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
        conn = db()
        try:
            row = conn.execute(
                "SELECT * FROM users WHERE username_lower = ?", (username.lower(),)
            ).fetchone()
            if not row or hash_pw(password, row["salt"]) != row["pwhash"]:
                return self._send(401, {"error": "bad_credentials"})
            token = make_token(conn, row["id"])
            return self._send(200, {"token": token, "user": user_public(row)})
        finally:
            conn.close()

    def _logout(self):
        token = self._token()
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
            conn.execute(
                "UPDATE users SET data = ? WHERE id = ?",
                (json.dumps(data), row["id"]),
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
            if len(q) < 2:
                return self._send(200, {"users": []})
            rows = conn.execute(
                "SELECT * FROM users WHERE username_lower LIKE ? AND id != ? "
                "ORDER BY username LIMIT 15",
                (f"%{q.lower()}%", me["id"]),
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
                # Host ayrıldı → odayı tamamen kaldır
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
            b = self._body()
            code = (b.get("code") or "").strip().upper()
            score = int(b.get("score") or 0)
            best = int(b.get("best") or 0)
            done = 1 if b.get("done") else 0
            conn.execute(
                "UPDATE room_players SET score=?, best=?, done=? WHERE code=? AND user_id=?",
                (score, best, done, code, me["id"]),
            )
            conn.commit()
            return self._send(200, {"room": room_state(conn, code)})
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
