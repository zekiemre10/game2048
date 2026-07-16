// ============================================================
//  2048 — Süre biçimlendirme (saf, test edilebilir)
// ============================================================

/**
 * Saniyeyi `mm:ss` biçimine çevirir.
 * 60 dakikayı aşarsa saat de eklenir (`h:mm:ss`).
 * @example formatTime(0)   => "00:00"
 * @example formatTime(75)  => "01:15"
 * @example formatTime(3661) => "1:01:01"
 */
export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
