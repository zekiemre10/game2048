import { DAILY_DURATION, dailySeed, utcDayKey } from './daily-challenge';

describe('Günlük meydan okuma — tohum ve gün anahtarı', () => {
  it('gün anahtarı UTC ve YYYY-MM-DD biçiminde', () => {
    const d = new Date(Date.UTC(2026, 6, 24, 23, 59, 0));
    expect(utcDayKey(d)).toBe('2026-07-24');
    // Ay/gün tek haneliyse sıfırla doldurulur
    expect(utcDayKey(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01-05');
  });

  it('yerel saat diliminden ETKİLENMEZ (herkes aynı günü alır)', () => {
    // Aynı an, farklı gösterimler → aynı UTC günü
    const t = Date.UTC(2026, 6, 24, 12, 0, 0);
    expect(utcDayKey(new Date(t))).toBe(utcDayKey(new Date(t)));
  });

  it('aynı gün için tohum HER ZAMAN aynı', () => {
    expect(dailySeed('2026-07-24')).toBe(dailySeed('2026-07-24'));
  });

  it('farklı günler farklı tohum verir', () => {
    const a = dailySeed('2026-07-24');
    const b = dailySeed('2026-07-25');
    const c = dailySeed('2026-01-01');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it('tohum pozitif 32-bit tam sayıdır', () => {
    for (const day of ['2026-07-24', '2026-12-31', '2020-02-29']) {
      const s = dailySeed(day);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('sunucudaki formülle aynı sonucu üretir (referans değerler)', () => {
    // Bu değerler sunucudaki daily_seed() ile doğrulandı — ikisi
    // ayrışırsa oyuncular farklı tahtalar oynar, sıralama anlamsızlaşır.
    expect(dailySeed('2026-07-24')).toBe(1100487036);
    expect(dailySeed('2026-07-25')).toBe(1117264655);
    expect(dailySeed('2026-01-01')).toBe(2049302883);
  });

  it('süre herkes için sabit', () => {
    expect(DAILY_DURATION).toBe(180);
  });
});
