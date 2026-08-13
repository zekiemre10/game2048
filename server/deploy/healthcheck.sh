#!/usr/bin/env bash
# ============================================================
#  2048 — sağlık kontrolü: /health yoklar, başarısızsa bildirir
#
#  game2048-healthcheck.timer ile ~5 dakikada bir çalışır. Başarısızsa journald'a
#  yazar, (ayarlıysa) webhook'a bildirir ve askıda kalmış süreci yeniden başlatır.
#  systemd zaten ÇÖKEN süreci yeniden başlatır; bu kontrol "çalışıyor ama yanıt
#  vermiyor" (asılı/kilitli) durumunu da yakalar.
#
#  Ortam: GAME2048_HEALTH_URL, GAME2048_SERVICE, GAME2048_ALERT_WEBHOOK.
# ============================================================
set -uo pipefail

URL="${GAME2048_HEALTH_URL:-http://127.0.0.1:8092/health}"
SERVICE="${GAME2048_SERVICE:-game2048-api}"

if curl -fsS --max-time 5 "$URL" 2>/dev/null | grep -q '"ok"'; then
  exit 0
fi

echo "SAĞLIK KONTROLÜ BAŞARISIZ: $URL" >&2

if [ -n "${GAME2048_ALERT_WEBHOOK:-}" ]; then
  curl -fsS -m 5 -X POST -H 'Content-Type: application/json' \
    -d "{\"text\":\"⚠️ 2048-api sağlık kontrolü başarısız ($URL)\"}" \
    "$GAME2048_ALERT_WEBHOOK" >/dev/null 2>&1 || true
fi

# Askıda kalmış (çökmemiş ama yanıtsız) süreci yeniden başlatmayı dene.
systemctl restart "$SERVICE" 2>/dev/null || true
exit 1
