// ============================================================
//  2048 — Günlük meydan okuma
//  Herkes o gün AYNI tahtayı oynar: tohum gün anahtarından türetilir.
//  Formül backend'deki `daily_seed` ile BİREBİR aynıdır (FNV-1a).
// ============================================================

/** Bugünün gün anahtarı (UTC) — `YYYY-MM-DD`. */
export function utcDayKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Gün anahtarından kararlı tohum (FNV-1a, 32 bit).
 * Sunucudaki `daily_seed` ile aynı sonucu vermelidir; aksi hâlde
 * oyuncular farklı tahtalar oynar ve sıralama anlamsızlaşır.
 */
export function dailySeed(day: string): number {
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}

/** Günlük meydan okuma süresi (saniye) — herkes için eşit. */
export const DAILY_DURATION = 180;
