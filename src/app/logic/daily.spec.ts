import {
  dailyRewardAmount,
  dayKey,
  streakAfterActivity,
  yesterdayKey,
} from './daily';

describe('daily yardımcıları', () => {
  it('dayKey yerel YYYY-MM-DD verir', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('yesterdayKey bir önceki günü verir (ay/yıl sınırı dahil)', () => {
    expect(yesterdayKey(new Date(2026, 2, 1))).toBe('2026-02-28');
    expect(yesterdayKey(new Date(2026, 0, 1))).toBe('2025-12-31');
  });

  it('streak: bugün zaten sayıldıysa değişmez', () => {
    expect(streakAfterActivity(5, '2026-01-05', '2026-01-05', '2026-01-04')).toBe(5);
  });

  it('streak: dün oynanmışsa +1', () => {
    expect(streakAfterActivity(5, '2026-01-04', '2026-01-05', '2026-01-04')).toBe(6);
  });

  it('streak: boşluk varsa 1’e sıfırlanır', () => {
    expect(streakAfterActivity(5, '2026-01-01', '2026-01-05', '2026-01-04')).toBe(1);
  });

  it('streak: ilk kez (lastDay null) → 1', () => {
    expect(streakAfterActivity(0, null, '2026-01-05', '2026-01-04')).toBe(1);
  });

  it('günlük ödül seriye göre artar, 7. günde tavan', () => {
    expect(dailyRewardAmount(1)).toBe(30); // 20 + 1*10
    expect(dailyRewardAmount(3)).toBe(50);
    expect(dailyRewardAmount(7)).toBe(90);
    expect(dailyRewardAmount(20)).toBe(90); // tavan
  });
});
