import { DAILY_REWARDS, REWARD_CYCLE, cycleDay, rewardForStreak } from './daily-rewards';

describe('7 günlük ödül takvimi', () => {
  it('tam 7 gün vardır ve günler 1..7 sırasıyla numaralı', () => {
    expect(REWARD_CYCLE).toBe(7);
    expect(DAILY_REWARDS.length).toBe(7);
    DAILY_REWARDS.forEach((r, i) => expect(r.day).toBe(i + 1));
  });

  it('her günde bir ödül vardır (altın veya güç)', () => {
    for (const r of DAILY_REWARDS) {
      const hasGold = r.gold > 0;
      const hasPower = r.power !== null && r.powerCount > 0;
      expect(hasGold || hasPower).toBe(true);
    }
  });

  it('altın ödülleri gün ilerledikçe ARTAR', () => {
    const goldDays = DAILY_REWARDS.filter((r) => r.gold > 0);
    for (let i = 1; i < goldDays.length; i++) {
      expect(goldDays[i].gold).toBeGreaterThan(goldDays[i - 1].gold);
    }
  });

  it('7. gün en büyük ödüldür', () => {
    const last = DAILY_REWARDS[6];
    const maxOther = Math.max(...DAILY_REWARDS.slice(0, 6).map((r) => r.gold));
    expect(last.gold).toBeGreaterThan(maxOther);
    expect(last.power).not.toBeNull(); // hem altın hem güç
  });

  it('döngü günü 1..7 arasında kalır ve 8. günde başa döner', () => {
    expect(cycleDay(1)).toBe(1);
    expect(cycleDay(7)).toBe(7);
    expect(cycleDay(8)).toBe(1); // yeni tur
    expect(cycleDay(15)).toBe(1);
    expect(cycleDay(14)).toBe(7);
  });

  it('geçersiz/sıfır seri ilk güne düşer', () => {
    expect(cycleDay(0)).toBe(1);
    expect(cycleDay(-5)).toBe(1);
  });

  it('rewardForStreak doğru günün ödülünü verir', () => {
    expect(rewardForStreak(3).power).toBe('bomb');
    expect(rewardForStreak(5).power).toBe('undo');
    expect(rewardForStreak(7).day).toBe(7);
    // 10. gün = döngüde 3. gün (bomba)
    expect(rewardForStreak(10).day).toBe(3);
  });

  it('güç veren günlerde adet pozitiftir', () => {
    for (const r of DAILY_REWARDS) {
      if (r.power) expect(r.powerCount).toBeGreaterThan(0);
      else expect(r.powerCount).toBe(0);
    }
  });
});
