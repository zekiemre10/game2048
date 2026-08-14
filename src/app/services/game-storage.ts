// ============================================================
//  2048 — Kalıcılık katmanı (localStorage)
//
//  Oyun servisinin tüm okuma/yazma yardımcıları TEK yerde toplandı.
//  Hepsi saf fonksiyon: depolama yoksa (gizli mod, SSR, kota) oyunu
//  bozmadan güvenli varsayılana düşerler. Anahtarlar da burada yaşar.
// ============================================================

import { PowerInventory, emptyInventory } from '../models/power.model';
import { MissionProgress } from '../models/mission.model';

// --- localStorage anahtarları -------------------------------
const BEST_SCORE_KEY = 'game2048.bestScore';
const BEST_LEVEL_KEY = 'game2048.bestLevel';
const GOLD_KEY = 'game2048.gold';
const TOTAL_EARNED_KEY = 'game2048.totalGoldEarned';
const PREFS_AT_KEY = 'game2048.prefsAt'; // ad/avatar en son ne zaman değişti (bulut birleştirmede LWW)
const REWARDED_LEVELS_KEY = 'game2048.rewardedLevels';
const POWERS_KEY = 'game2048.powers';
const NAME_KEY = 'game2048.name';
const AVATAR_KEY = 'game2048.avatar';
const ASSISTANT_KEY = 'game2048.assistant';
const CHAMPION_KEY = 'game2048.championships';
const STATS_KEY = 'game2048.stats';
const CHARWINS_KEY = 'game2048.charwins'; // karakter bazlı yarış galibiyeti
const STREAK_KEY = 'game2048.streak';
const DAILY_KEY = 'game2048.dailyDay';
const ACHIEVEMENTS_KEY = 'game2048.achievements';

/** Görev anahtarları — çekirdek servis günlük/haftalık ayrımı için doğrudan kullanır. */
export const DAILY_MISSIONS_KEY = 'game2048.dailyMissions';
export const WEEKLY_MISSIONS_KEY = 'game2048.weeklyMissions';

/** Seçilebilir profil avatarları (ilk sıradaki varsayılan). */
export const AVATARS = [
  '👤',
  '😎',
  '🤖',
  '🐱',
  '🐉',
  '🌟',
  '🦊',
  '🐼',
  '👾',
  '🦁',
  '🐧',
  '🦄',
  '🍀',
  '🔥',
  '⚡',
  '🎩',
];

// --- En yüksek skor / seviye --------------------------------

/** localStorage'dan en yüksek skoru okur (yoksa/hatalıysa 0). */
export function loadBestScore(): number {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem(BEST_SCORE_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** En yüksek skoru localStorage'a yazar (hata olursa sessizce geçer). */
export function saveBestScore(best: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(BEST_SCORE_KEY, String(best));
  } catch {
    // Depolama kullanılamıyorsa (gizli mod, kota vb.) oyunu bozma
  }
}

/** localStorage'dan ulaşılan en yüksek seviyeyi okur (yoksa 0). */
export function loadBestLevel(): number {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem(BEST_LEVEL_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Ulaşılan en yüksek seviyeyi localStorage'a yazar. */
export function saveBestLevel(level: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(BEST_LEVEL_KEY, String(level));
  } catch {
    /* yoksay */
  }
}

// --- Altın ekonomisi ----------------------------------------

/** localStorage'dan toplam altını okur (yoksa 0). */
export function loadGold(): number {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem(GOLD_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Toplam altını localStorage'a yazar. */
export function saveGold(gold: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(GOLD_KEY, String(gold));
  } catch {
    /* yoksay */
  }
}

/** Bugüne kadar kazanılan toplam altını okur. */
export function loadTotalEarned(): number {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem(TOTAL_EARNED_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Toplam kazanılan altını yazar. */
export function saveTotalEarned(total: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(TOTAL_EARNED_KEY, String(total));
  } catch {
    /* yoksay */
  }
}

// --- Tercih zaman damgası (bulut LWW) -----------------------

/** Tercih (ad/avatar) son değişiklik zaman damgasını okur. */
export function loadPrefsAt(): number {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const n = parseInt(localStorage.getItem(PREFS_AT_KEY) || '0', 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Tercih son değişiklik zaman damgasını yazar. */
export function savePrefsAt(ts: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(PREFS_AT_KEY, String(ts));
  } catch {
    /* yoksay */
  }
}

// --- Ödüllü seviyeler + güç envanteri -----------------------

export function loadRewardedLevels(): number[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(REWARDED_LEVELS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

/** Ödülü alınmış seviyeleri localStorage'a yazar. */
export function saveRewardedLevels(levels: Set<number>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(REWARDED_LEVELS_KEY, JSON.stringify([...levels]));
  } catch {
    /* yoksay */
  }
}

/** Güç envanterini localStorage'dan okur (yoksa boş). */
export function loadPowers(): PowerInventory {
  const base = emptyInventory();
  try {
    if (typeof localStorage === 'undefined') return base;
    const raw = localStorage.getItem(POWERS_KEY);
    if (!raw) return base;
    const obj = JSON.parse(raw);
    for (const key of Object.keys(base) as (keyof PowerInventory)[]) {
      const n = obj?.[key];
      if (typeof n === 'number' && n >= 0) base[key] = Math.floor(n);
    }
    return base;
  } catch {
    return base;
  }
}

/** Güç envanterini localStorage'a yazar. */
export function savePowers(inv: PowerInventory): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(POWERS_KEY, JSON.stringify(inv));
  } catch {
    /* yoksay */
  }
}

// --- Profil / ad / avatar / asistan / şampiyonluk -----------

export function loadName(): string {
  try {
    return localStorage?.getItem(NAME_KEY) || 'Oyuncu';
  } catch {
    return 'Oyuncu';
  }
}

export function saveName(name: string): void {
  try {
    localStorage?.setItem(NAME_KEY, name);
  } catch {
    /* yoksay */
  }
}

export function loadAssistant(): boolean {
  try {
    return localStorage?.getItem(ASSISTANT_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveAssistant(on: boolean): void {
  try {
    localStorage?.setItem(ASSISTANT_KEY, on ? '1' : '0');
  } catch {
    /* yoksay */
  }
}

export function loadChampionships(): number {
  try {
    const n = Number(localStorage?.getItem(CHAMPION_KEY) || 0);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveChampionships(n: number): void {
  try {
    localStorage?.setItem(CHAMPION_KEY, String(n));
  } catch {
    /* yoksay */
  }
}

export function loadAvatar(): string {
  try {
    const v = localStorage?.getItem(AVATAR_KEY);
    return v && AVATARS.includes(v) ? v : AVATARS[0];
  } catch {
    return AVATARS[0];
  }
}

export function saveAvatar(a: string): void {
  try {
    localStorage?.setItem(AVATAR_KEY, a);
  } catch {
    /* yoksay */
  }
}

// --- İstatistikler ------------------------------------------

export interface StatsBlob {
  gamesPlayed: number;
  gamesWon: number;
  bestTile: number;
  totalMoves: number;
  bombUsed: number;
}

function readStats(): Partial<StatsBlob> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STATS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function loadStat(key: keyof StatsBlob): number {
  const v = readStats()[key];
  return typeof v === 'number' && v >= 0 ? v : 0;
}

export function saveStats(blob: StatsBlob): void {
  try {
    localStorage?.setItem(STATS_KEY, JSON.stringify(blob));
  } catch {
    /* yoksay */
  }
}

// --- Karakter bazlı yarış galibiyeti -----------------------
// Her bot karakteri için: kaç kez karşılaşıldı + kaç kez yenildi (skorca geçildi).
// Yalnızca YEREL tutulur (bulut senkronu alan-bazlı birleştirmede bilinmeyen
// alanları düşürür; bu istatistik cihaz-yerel bir başarımdır).

export interface CharacterWin {
  faced: number;
  beaten: number;
}
export type CharacterWinsBlob = Record<string, CharacterWin>;

export function loadCharacterWins(): CharacterWinsBlob {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(CHARWINS_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

export function saveCharacterWins(blob: CharacterWinsBlob): void {
  try {
    localStorage?.setItem(CHARWINS_KEY, JSON.stringify(blob));
  } catch {
    /* yoksay */
  }
}

// --- Gün serisi (streak) ------------------------------------

function readStreak(): { current?: number; best?: number; day?: string } {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STREAK_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function loadStreak(key: 'current' | 'best'): number {
  const v = readStreak()[key];
  return typeof v === 'number' && v >= 0 ? v : 0;
}

export function loadStreakDay(): string | null {
  return readStreak().day ?? null;
}

export function saveStreak(current: number, best: number, day: string): void {
  try {
    localStorage?.setItem(STREAK_KEY, JSON.stringify({ current, best, day }));
  } catch {
    /* yoksay */
  }
}

// --- Günlük meydan okuma günü -------------------------------

export function loadDailyDay(): string | null {
  try {
    return localStorage?.getItem(DAILY_KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveDailyDay(day: string): void {
  try {
    localStorage?.setItem(DAILY_KEY, day);
  } catch {
    /* yoksay */
  }
}

// --- Başarımlar ---------------------------------------------

export function loadAchievements(): Set<string> {
  const set = new Set<string>();
  try {
    if (typeof localStorage === 'undefined') return set;
    const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) for (const id of arr) if (typeof id === 'string') set.add(id);
    }
  } catch {
    /* yoksay */
  }
  return set;
}

export function saveAchievements(set: Set<string>): void {
  try {
    localStorage?.setItem(ACHIEVEMENTS_KEY, JSON.stringify([...set]));
  } catch {
    /* yoksay */
  }
}

// --- Görevler (günlük + haftalık) ---------------------------

/** Görevleri okur: { period, list }. */
export function loadMissions(key: string): {
  period: string | null;
  list: MissionProgress[];
} {
  try {
    if (typeof localStorage === 'undefined') return { period: null, list: [] };
    const raw = localStorage.getItem(key);
    if (!raw) return { period: null, list: [] };
    const obj = JSON.parse(raw);
    const list = Array.isArray(obj?.list)
      ? obj.list.filter(
          (m: unknown): m is MissionProgress =>
            !!m && typeof (m as MissionProgress).id === 'string',
        )
      : [];
    return { period: typeof obj?.period === 'string' ? obj.period : null, list };
  } catch {
    return { period: null, list: [] };
  }
}

/** Görevleri yazar. */
export function saveMissions(key: string, period: string | null, list: MissionProgress[]): void {
  try {
    localStorage?.setItem(key, JSON.stringify({ period, list }));
  } catch {
    /* yoksay */
  }
}
