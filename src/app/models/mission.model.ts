// ============================================================
//  2048 — Görevler (günlük + haftalık)
//  Metrik oyun sırasında sayılır; hedefe ulaşınca altın ödülü alınır.
// ============================================================

export type MissionMetric =
  | 'games' // oyun oyna
  | 'wins' // oyun kazan
  | 'merges' // birleşme yap
  | 'moves' // hamle yap
  | 'levels' // seviye tamamla
  | 'powers' // güç kullan
  | 'gold' // altın kazan
  | 'reach256' // 256 karesi yap
  | 'reach512' // 512 karesi yap
  | 'reach1024'; // 1024 karesi yap

export interface MissionDef {
  id: string;
  icon: string;
  desc: string;
  metric: MissionMetric;
  target: number;
  gold: number;
}

/** Kaydedilen görev durumu. */
export interface MissionProgress {
  id: string;
  progress: number;
  claimed: boolean;
}

/** Günlük görev havuzu (her gün buradan rastgele DAILY_COUNT tanesi seçilir). */
export const DAILY_POOL: MissionDef[] = [
  { id: 'd-games3', icon: '🎮', desc: '3 oyun oyna', metric: 'games', target: 3, gold: 30 },
  { id: 'd-win1', icon: '🏆', desc: '1 oyun kazan', metric: 'wins', target: 1, gold: 40 },
  { id: 'd-merge30', icon: '🔀', desc: '30 birleşme yap', metric: 'merges', target: 30, gold: 30 },
  { id: 'd-move60', icon: '👉', desc: '60 hamle yap', metric: 'moves', target: 60, gold: 20 },
  { id: 'd-level1', icon: '🎯', desc: '1 seviye tamamla', metric: 'levels', target: 1, gold: 35 },
  { id: 'd-power1', icon: '⚡', desc: '1 güç kullan', metric: 'powers', target: 1, gold: 25 },
  { id: 'd-256', icon: '🟧', desc: '256 karesi yap', metric: 'reach256', target: 1, gold: 30 },
  { id: 'd-512', icon: '🟨', desc: '512 karesi yap', metric: 'reach512', target: 1, gold: 45 },
];

/** Haftalık görev havuzu. */
export const WEEKLY_POOL: MissionDef[] = [
  { id: 'w-games20', icon: '🎮', desc: '20 oyun oyna', metric: 'games', target: 20, gold: 120 },
  { id: 'w-win5', icon: '🏆', desc: '5 oyun kazan', metric: 'wins', target: 5, gold: 150 },
  { id: 'w-merge300', icon: '🔀', desc: '300 birleşme yap', metric: 'merges', target: 300, gold: 120 },
  { id: 'w-level5', icon: '🎯', desc: '5 seviye tamamla', metric: 'levels', target: 5, gold: 140 },
  { id: 'w-power10', icon: '⚡', desc: '10 güç kullan', metric: 'powers', target: 10, gold: 100 },
  { id: 'w-1024', icon: '🟪', desc: '1024 karesi yap', metric: 'reach1024', target: 1, gold: 180 },
  { id: 'w-gold500', icon: '💰', desc: '500 altın kazan', metric: 'gold', target: 500, gold: 100 },
];

export const DAILY_COUNT = 3;
export const WEEKLY_COUNT = 3;

export function missionDef(id: string): MissionDef | undefined {
  return [...DAILY_POOL, ...WEEKLY_POOL].find((m) => m.id === id);
}
