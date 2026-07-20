import { MissionDef } from '../models/mission.model';

// ============================================================
//  2048 — Görev seçimi (saf, deterministik, test edilebilir)
//  Aynı gün/hafta herkese AYNI görevleri verir (tarih tohumlu).
// ============================================================

/** Basit string hash (32-bit). */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — tohumlu sözde-rastgele üreteç (0..1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Havuzdan `count` tane görevi tohuma göre DETERMİNİSTİK seçer.
 * Aynı seed → aynı görevler.
 */
export function pickMissions(
  pool: MissionDef[],
  count: number,
  seed: string,
): MissionDef[] {
  const rng = mulberry32(hashStr(seed));
  const arr = [...pool];
  // Fisher-Yates (tohumlu)
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(count, arr.length));
}

/** Bir tarihin ISO hafta anahtarı: `YYYY-Www`. */
export function weekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // Perşembe'ye kaydır (ISO)
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = date.getTime();
  date.setUTCMonth(0, 1);
  if (date.getUTCDay() !== 4) {
    date.setUTCMonth(0, 1 + ((4 - date.getUTCDay() + 7) % 7));
  }
  const week = 1 + Math.round((firstThursday - date.getTime()) / 604800000);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}
