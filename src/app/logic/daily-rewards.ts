import { PowerId } from '../models/power.model';

// ============================================================
//  2048 — 7 günlük ödül takvimi
//  Her gün üst üste oynadıkça daha iyi ödül: altın büyür, aralara
//  güçler serpiştirilir, 7. gün büyük ödül. 7. günden sonra döngü
//  baştan başlar (seri devam ettikçe hep 7 günlük tur).
// ============================================================

export interface DailyReward {
  /** Kaçıncı gün (1-7). */
  day: number;
  /** Verilen altın (0 ise yalnızca güç verilir). */
  gold: number;
  /** Verilen güç (yoksa null). */
  power: PowerId | null;
  /** Güçten kaç adet. */
  powerCount: number;
  /** Takvimde gösterilecek simge. */
  icon: string;
}

/**
 * 7 günlük döngü. Değerler bilinçli olarak artan: oyuncu seriyi
 * sürdürdükçe ödül gözle görülür şekilde iyileşir, 7. gün zirve yapar.
 */
export const DAILY_REWARDS: DailyReward[] = [
  { day: 1, gold: 30, power: null, powerCount: 0, icon: '💰' },
  { day: 2, gold: 50, power: null, powerCount: 0, icon: '💰' },
  { day: 3, gold: 0, power: 'bomb', powerCount: 1, icon: '💣' },
  { day: 4, gold: 90, power: null, powerCount: 0, icon: '💰' },
  { day: 5, gold: 0, power: 'undo', powerCount: 2, icon: '↩️' },
  { day: 6, gold: 140, power: null, powerCount: 0, icon: '💰' },
  { day: 7, gold: 250, power: 'hint', powerCount: 3, icon: '🎁' },
];

/** Döngü uzunluğu. */
export const REWARD_CYCLE = DAILY_REWARDS.length;

/**
 * Serideki güne karşılık gelen döngü günü (1-7).
 * 8. gün tekrar 1'e döner; böylece seri kırılmadıkça tur devam eder.
 */
export function cycleDay(streak: number): number {
  const s = Math.max(1, Math.floor(streak));
  return ((s - 1) % REWARD_CYCLE) + 1;
}

/** Serideki güne karşılık gelen ödül. */
export function rewardForStreak(streak: number): DailyReward {
  return DAILY_REWARDS[cycleDay(streak) - 1];
}
