import { RANKS, rankFor, rankPoints } from './rank';

describe('Ünvan (rütbe) sistemi', () => {
  it('puan formülü bileşenleri doğru toplar', () => {
    // 10 oyun (100) + 2000 skor / 20 (100) + 2. seviye (100) + 1 başarım (150)
    expect(
      rankPoints({
        gamesPlayed: 10,
        bestScore: 2000,
        bestLevel: 2,
        achievements: 1,
      }),
    ).toBe(450);
  });

  it('negatif/bozuk değerlerde çökmez, 0 sayar', () => {
    expect(
      rankPoints({
        gamesPlayed: -5,
        bestScore: -100,
        bestLevel: -1,
        achievements: -2,
      }),
    ).toBe(0);
  });

  it('yeni oyuncu ilk ünvanda başlar', () => {
    const info = rankFor(0);
    expect(info.rank.id).toBe('novice');
    expect(info.next?.id).toBe('apprentice');
    expect(info.percent).toBe(0);
    expect(info.remaining).toBe(500);
  });

  it('eşik değerinde bir sonraki ünvana geçer', () => {
    expect(rankFor(499).rank.id).toBe('novice');
    expect(rankFor(500).rank.id).toBe('apprentice');
    expect(rankFor(1500).rank.id).toBe('expert');
    expect(rankFor(3500).rank.id).toBe('master');
    expect(rankFor(7000).rank.id).toBe('legend');
  });

  it('ara değerde ilerleme yüzdesi doğru', () => {
    // Kalfa 500, Usta 1500 → 1000'de yolun yarısı
    const info = rankFor(1000);
    expect(info.rank.id).toBe('apprentice');
    expect(info.percent).toBe(50);
    expect(info.remaining).toBe(500);
  });

  it('en yüksek ünvanda sonraki yok, %100 gösterir', () => {
    const info = rankFor(99999);
    expect(info.rank.id).toBe('legend');
    expect(info.next).toBeNull();
    expect(info.percent).toBe(100);
    expect(info.remaining).toBe(0);
  });

  it('ünvan eşikleri artan sırada tanımlı', () => {
    for (let i = 1; i < RANKS.length; i++) {
      expect(RANKS[i].minPoints).toBeGreaterThan(RANKS[i - 1].minPoints);
    }
  });
});
