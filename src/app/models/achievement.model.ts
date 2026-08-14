// ============================================================
//  2048 — Başarımlar (altın ödüllü hedefler)
//  Koşullar GameService.achievementMet() içinde değerlendirilir.
//  Metinler i18n'de: ach.<id>.name · ach.<id>.desc (src/app/i18n/<lang>.json).
// ============================================================

export interface Achievement {
  id: string;
  icon: string;
  /** Açılınca verilen altın. */
  gold: number;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'tile-512', icon: '🥉', gold: 50 },
  { id: 'tile-1024', icon: '🥈', gold: 75 },
  { id: 'first-win', icon: '🏆', gold: 150 },
  { id: 'level-3', icon: '🎯', gold: 80 },
  { id: 'games-10', icon: '🎮', gold: 40 },
  { id: 'streak-3', icon: '🔥', gold: 60 },
  { id: 'streak-7', icon: '⚡', gold: 150 },
  { id: 'bomb-use', icon: '💣', gold: 30 },
  { id: 'rich', icon: '💰', gold: 100 },
];
