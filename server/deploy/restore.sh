#!/usr/bin/env bash
# ============================================================
#  2048 — yedekten GERİ YÜKLEME
#
#  Kullanım:  sudo ./restore.sh /var/backups/game2048-api/app-YYYYMMDD-HHMMSS.db.gz
#
#  Servisi durdurur (DB kilidi bırakılsın), mevcut DB'yi güvenlik için saklar,
#  yedeği bütünlük kontrolünden geçirip yerine koyar, servisi başlatır.
#  (Bkz. deploy/README.md — geri yükleme EN AZ BİR KEZ denenmeli.)
# ============================================================
set -euo pipefail

BACKUP="${1:?Kullanim: restore.sh <yedek.db.gz|yedek.db>}"
DB="${GAME2048_DB:-/var/lib/game2048-api/app.db}"
SERVICE="${GAME2048_SERVICE:-game2048-api}"
[ -f "$BACKUP" ] || { echo "Yedek yok: $BACKUP" >&2; exit 1; }

echo "1) Servis durduruluyor: $SERVICE"
systemctl stop "$SERVICE" 2>/dev/null || true

tmp="$(mktemp)"
case "$BACKUP" in
  *.gz) gunzip -c "$BACKUP" > "$tmp" ;;
  *)    cp "$BACKUP" "$tmp" ;;
esac

echo "2) Yedek bütünlük kontrolü"
if command -v sqlite3 >/dev/null 2>&1; then
  ok="$(sqlite3 "$tmp" 'PRAGMA integrity_check;')"
  [ "$ok" = "ok" ] || { echo "Yedek BOZUK ($ok) — geri yükleme iptal." >&2; rm -f "$tmp"; systemctl start "$SERVICE" || true; exit 1; }
fi

if [ -f "$DB" ]; then
  keep="$DB.pre-restore-$(date +%Y%m%d-%H%M%S)"
  cp "$DB" "$keep"
  echo "3) Mevcut DB saklandı: $keep"
fi

mv "$tmp" "$DB"
chown game2048:game2048 "$DB" 2>/dev/null || true
chmod 640 "$DB" 2>/dev/null || true

echo "4) Servis başlatılıyor"
systemctl start "$SERVICE"
sleep 1
curl -fsS --max-time 5 "${GAME2048_HEALTH_URL:-http://127.0.0.1:8092/health}" >/dev/null \
  && echo "✓ Geri yüklendi ve sağlık kontrolü geçti: $BACKUP → $DB" \
  || echo "! Geri yüklendi ama sağlık kontrolü geçmedi — journalctl -u $SERVICE"
