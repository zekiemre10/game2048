// ============================================================
//  2048 — Günlük meydan okuma
//  Herkes o gün AYNI tahtayı oynar. Tohum önce YZ ile KÜRATÖRLENMİŞ takvimden
//  gelir (adil + ilginç tahtalar); takvim kapsamı dışında FORMÜLE (FNV-1a) düşer.
//  Takvim + formül backend ile BİREBİR aynıdır (belirleyicilik şart: istemci
//  oynar, sunucu aynı tohumla replay ederek doğrular).
// ============================================================
import { DAILY_CALENDAR } from './daily-calendar.data';

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

/** `YYYY-MM-DD` gününün takvim başlangıcına göre sıfır tabanlı gün dizini (UTC). */
function dayIndex(day: string, startDay: string): number {
  const [y1, m1, d1] = startDay.split('-').map(Number);
  const [y2, m2, d2] = day.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/**
 * Günün tohumu: KÜRATÖRLÜ takvimde varsa oradan (adil + ilginç), yoksa FORMÜL
 * (dailySeed) yedeği. Sunucudaki `daily_seed` ile BİREBİR aynı mantık — aksi
 * hâlde oyuncu farklı tahta oynar ve gönderdiği skor replay'de reddedilir.
 */
export function curatedDailySeed(day: string): number {
  const { startDay, seeds } = DAILY_CALENDAR;
  const i = dayIndex(day, startDay);
  if (i >= 0 && i < seeds.length) return seeds[i];
  return dailySeed(day); // takvim dışı → formül yedeği
}

/** Günlük meydan okuma süresi (saniye) — herkes için eşit. */
export const DAILY_DURATION = 180;
