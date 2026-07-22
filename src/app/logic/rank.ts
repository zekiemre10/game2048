// ============================================================
//  2048 — Oyuncu ünvanı (rütbe)
//  Toplam emeği tek bir sayıya indirger ve ünvana çevirir.
//  Oyun içindeki "Seviye" modundan AYRI bir kavramdır: seviye tek bir
//  oyunun zorluğu, ünvan ise hesabın genel ilerlemesidir.
// ============================================================

/** Ünvan hesabına giren istatistikler. */
export interface RankStats {
  gamesPlayed: number;
  bestScore: number;
  bestLevel: number;
  achievements: number;
}

export interface Rank {
  id: string;
  icon: string;
  name: string;
  nameEn: string;
  /** Bu ünvana geçmek için gereken puan. */
  minPoints: number;
}

/** Ünvan basamakları (artan sırada). */
export const RANKS: Rank[] = [
  { id: 'novice', icon: '🌱', name: 'Çırak', nameEn: 'Novice', minPoints: 0 },
  { id: 'apprentice', icon: '🔧', name: 'Kalfa', nameEn: 'Apprentice', minPoints: 500 },
  { id: 'expert', icon: '⭐', name: 'Usta', nameEn: 'Expert', minPoints: 1500 },
  { id: 'master', icon: '🏅', name: 'Üstat', nameEn: 'Master', minPoints: 3500 },
  { id: 'legend', icon: '👑', name: 'Efsane', nameEn: 'Legend', minPoints: 7000 },
];

/**
 * Ünvan puanı. Kasıtlı olarak BASİT ve açıklanabilir tutuldu; oyuncu
 * puanının nereden geldiğini panelde okuyabilsin diye:
 *   her oyun 10 · en iyi skor / 20 · her seviye 50 · her başarım 150
 */
export function rankPoints(s: RankStats): number {
  const games = Math.max(0, s.gamesPlayed) * 10;
  const score = Math.floor(Math.max(0, s.bestScore) / 20);
  const level = Math.max(0, s.bestLevel) * 50;
  const ach = Math.max(0, s.achievements) * 150;
  return games + score + level + ach;
}

export interface RankInfo {
  /** Şu anki ünvan. */
  rank: Rank;
  /** Bir sonraki ünvan (en üstteyse null). */
  next: Rank | null;
  /** Toplam puan. */
  points: number;
  /** Sonraki ünvana ilerleme yüzdesi (0-100). En üstte 100. */
  percent: number;
  /** Sonraki ünvan için gereken kalan puan (en üstte 0). */
  remaining: number;
}

/** Puanı ünvana çevirir ve sonraki basamağa ilerlemeyi hesaplar. */
export function rankFor(points: number): RankInfo {
  const p = Math.max(0, points);
  let index = 0;
  for (let i = 0; i < RANKS.length; i++) {
    if (p >= RANKS[i].minPoints) index = i;
  }
  const rank = RANKS[index];
  const next = index + 1 < RANKS.length ? RANKS[index + 1] : null;

  if (!next) return { rank, next: null, points: p, percent: 100, remaining: 0 };

  const span = next.minPoints - rank.minPoints;
  const done = p - rank.minPoints;
  return {
    rank,
    next,
    points: p,
    percent: Math.max(0, Math.min(100, Math.round((done / span) * 100))),
    remaining: Math.max(0, next.minPoints - p),
  };
}
