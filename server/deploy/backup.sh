#!/usr/bin/env bash
# ============================================================
#  2048 — app.db GÜVENLİ yedek (SQLite .backup) + rotate + retention
#
#  .backup kullanır (dosya KOPYALAMA DEĞİL): açık/çalışan veritabanında düz
#  `cp` bozuk yedek üretebilir; .backup çevrimiçi tutarlı bir kopya alır.
#  Zamanlanmış çalıştırma: game2048-backup.timer (günlük).
#
#  Ortam: GAME2048_DB, GAME2048_BACKUP_DIR, GAME2048_BACKUP_RETENTION (gün).
# ============================================================
set -euo pipefail

DB="${GAME2048_DB:-/var/lib/game2048-api/app.db}"
DEST_DIR="${GAME2048_BACKUP_DIR:-/var/backups/game2048-api}"
RETENTION_DAYS="${GAME2048_BACKUP_RETENTION:-14}"

[ -f "$DB" ] || { echo "DB yok: $DB" >&2; exit 1; }
mkdir -p "$DEST_DIR"
ts="$(date +%Y%m%d-%H%M%S)"
out="$DEST_DIR/app-$ts.db"

# --- Sıcak (online) yedek ---
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB" ".backup '$out'"
  ok="$(sqlite3 "$out" 'PRAGMA integrity_check;')"
  [ "$ok" = "ok" ] || { echo "YEDEK BOZUK ($ok): $out" >&2; rm -f "$out"; exit 1; }
else
  # sqlite3 CLI yoksa Python ile aynı .backup mekanizması (conn.backup).
  python3 - "$DB" "$out" <<'PY'
import sqlite3, sys
src, dst = sqlite3.connect(sys.argv[1]), sqlite3.connect(sys.argv[2])
with dst:
    src.backup(dst)
src.close(); dst.close()
PY
fi

gzip -f "$out"
echo "yedek alındı: $out.gz"

# --- Retention: RETENTION_DAYS'ten eski yedekleri sil ---
find "$DEST_DIR" -maxdepth 1 -name 'app-*.db.gz' -type f -mtime +"$RETENTION_DAYS" -print -delete
