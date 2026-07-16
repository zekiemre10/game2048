// ============================================================
//  2048 — Günlük/seri tarih yardımcıları (saf, test edilebilir)
// ============================================================

/** Bir tarihi yerel `YYYY-MM-DD` anahtarına çevirir. */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Verilen günün bir önceki gününün anahtarı. */
export function yesterdayKey(d: Date): string {
  const y = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  return dayKey(y);
}

/**
 * Aktivite sonrası yeni seri değerini hesaplar.
 * - Bugün zaten sayıldıysa değişmez.
 * - Dün oynanmışsa +1.
 * - Aksi halde (boşluk/ilk) 1'e sıfırlanır.
 */
export function streakAfterActivity(
  prevStreak: number,
  lastDay: string | null,
  today: string,
  yesterday: string,
): number {
  if (lastDay === today) return prevStreak;
  if (lastDay === yesterday) return prevStreak + 1;
  return 1;
}

/** Seriye göre günlük ödül miktarı (taban 20 + gün başına 10, tavan 90). */
export function dailyRewardAmount(streak: number): number {
  return 20 + Math.min(Math.max(streak, 1), 7) * 10;
}
