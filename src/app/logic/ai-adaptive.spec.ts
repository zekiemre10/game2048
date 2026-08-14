import { ADAPTIVE_LADDER, pickAdaptiveRung } from './ai';

/** Merdivendeki bir anahtarın dizini (test okunurluğu için). */
const idx = (key: string) => ADAPTIVE_LADDER.findIndex((r) => r.key === key);

describe('Uyarlanabilir eşleştirme — pickAdaptiveRung', () => {
  it('merdiven artan güçte sıralı (ölçülen ort. skor)', () => {
    for (let i = 1; i < ADAPTIVE_LADDER.length; i++) {
      expect(ADAPTIVE_LADDER[i].avg).toBeGreaterThan(ADAPTIVE_LADDER[i - 1].avg);
    }
  });

  it('geçmiş yoksa makul bir başlangıç rung’u döner (en zayıf/en güçlü değil)', () => {
    const key = pickAdaptiveRung(0);
    const i = idx(key);
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(ADAPTIVE_LADDER.length - 1);
  });

  it('yüksek ortalama → güçlü rung, düşük ortalama → zayıf rung (prevKey yok)', () => {
    expect(pickAdaptiveRung(3000)).toBe('hasty'); // en zayıf
    expect(pickAdaptiveRung(60000)).toBe('expert'); // en güçlü
    // Orta: hedef = 30000×1.1 = 33000 → en yakın 'balanced' (32231)
    expect(pickAdaptiveRung(30000)).toBe('balanced');
  });

  it('ortalama arttıkça seçilen rung dizini monoton artar (yumuşatmasız)', () => {
    let prev = -1;
    for (const avg of [1000, 5000, 15000, 22000, 30000, 40000, 70000]) {
      const i = idx(pickAdaptiveRung(avg));
      expect(i).toBeGreaterThanOrEqual(prev);
      prev = i;
    }
  });

  it('YUMUŞATMA: tek eşleşmede en çok bir basamak değişir (yukarı)', () => {
    // Önceki en zayıf, oyuncu çok güçlü → yine de yalnızca +1 basamak.
    const key = pickAdaptiveRung(60000, 'hasty');
    expect(idx(key)).toBe(idx('hasty') + 1); // 'medium'
  });

  it('YUMUŞATMA: üst üste kayıplarda kademeli KOLAYLAŞIR (aşağı, adım adım)', () => {
    // Uzman rakipten çok düşük skorlara: her eşleşmede bir basamak iner.
    let prev = 'expert';
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const next = pickAdaptiveRung(3000, prev);
      seen.push(next);
      expect(idx(next)).toBe(idx(prev) - 1); // tam bir basamak aşağı
      prev = next;
    }
    // Üç eşleşmede belirgin biçimde kolaylaştı (expert → corner → balanced → space)
    expect(seen).toEqual(['corner', 'balanced', 'space']);
  });

  it('döndürülen anahtar her zaman geçerli bir merdiven rung’udur', () => {
    for (const avg of [0, -5, 100, 25000, 999999]) {
      expect(idx(pickAdaptiveRung(avg))).toBeGreaterThanOrEqual(0);
    }
  });
});
