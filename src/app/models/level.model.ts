// ============================================================
//  2048 — Seviye modu tanımları
//  Her seviye: ulaşılması gereken hedef kare + süre sınırı.
//  İlerledikçe hedef büyür, süre kısalır → giderek zorlaşır.
// ============================================================

export interface LevelConfig {
  /** Seviye numarası (1'den başlar). */
  level: number;
  /** Ulaşılması gereken kare değeri. */
  target: number;
  /** Bu seviye için süre sınırı (saniye). */
  seconds: number;
  /** Seviye tamamlanınca kazanılan altın (seviye yükseldikçe artar). */
  gold: number;
}

/** Seviye listesi — hedef artar, süre azalır, altın ödülü artar. */
export const LEVELS: LevelConfig[] = [
  { level: 1, target: 128, seconds: 180, gold: 50 }, //  3:00
  { level: 2, target: 256, seconds: 150, gold: 75 }, //  2:30
  { level: 3, target: 512, seconds: 120, gold: 100 }, // 2:00
  { level: 4, target: 1024, seconds: 100, gold: 125 }, // 1:40
  { level: 5, target: 2048, seconds: 90, gold: 150 }, //  1:30
];

/** Toplam seviye sayısı. */
export const MAX_LEVEL = LEVELS.length;

/** Verilen seviyenin ayarını döndürür (sınır dışı ise son seviyeye kırpar). */
export function levelConfig(level: number): LevelConfig {
  const index = Math.min(Math.max(level, 1), MAX_LEVEL) - 1;
  return LEVELS[index];
}
