#!/usr/bin/env bash
# ============================================================
#  2048 — düzenli bakım: bütünlük + WAL checkpoint + VACUUM
#
#  VACUUM DB'yi kısa süre kilitler ve dosyayı sıkıştırır → DÜŞÜK TRAFİK saatinde
#  çalıştır (game2048-maintenance.timer haftalık, gece). integrity_check bozulmayı
#  erken yakalar. Bkz. deploy/README.md.
# ============================================================
set -euo pipefail

DB="${GAME2048_DB:-/var/lib/game2048-api/app.db}"
[ -f "$DB" ] || { echo "DB yok: $DB" >&2; exit 1; }

command -v sqlite3 >/dev/null 2>&1 || { echo "sqlite3 CLI gerekli (apt install sqlite3)" >&2; exit 1; }

# Meşgulse kısa bekle (canlı serviste kilit çakışmasına karşı).
ok="$(sqlite3 -cmd '.timeout 5000' "$DB" 'PRAGMA integrity_check;')"
if [ "$ok" != "ok" ]; then
  echo "BÜTÜNLÜK HATASI: $DB → $ok" >&2
  exit 1
fi
sqlite3 -cmd '.timeout 5000' "$DB" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null || true
sqlite3 -cmd '.timeout 10000' "$DB" 'VACUUM;'
echo "bakım tamam: $DB (integrity ok, vacuum yapıldı)"
