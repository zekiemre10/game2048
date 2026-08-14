import { curatedDailySeed, dailySeed, utcDayKey } from './daily-challenge';
import { DAILY_CALENDAR } from './daily-calendar.data';

/** Bir gün anahtarına N gün ekler (UTC). */
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return utcDayKey(t);
}

describe('Günlük tohum takvimi — küratörlü + formül yedeği', () => {
  it('takvimde ≥1 yıllık (≥365) küratörlü tohum var', () => {
    expect(DAILY_CALENDAR.seeds.length).toBeGreaterThanOrEqual(365);
    expect(DAILY_CALENDAR.startDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('başlangıç günü takvimin İLK tohumunu verir; ardışık günler sıradaki tohumu', () => {
    const { startDay, seeds } = DAILY_CALENDAR;
    expect(curatedDailySeed(startDay)).toBe(seeds[0]);
    expect(curatedDailySeed(addDays(startDay, 1))).toBe(seeds[1]);
    expect(curatedDailySeed(addDays(startDay, 10))).toBe(seeds[10]);
  });

  it('takvim ÖNCESİ günler FORMÜLE düşer (geçmiş bozulmaz)', () => {
    const before = addDays(DAILY_CALENDAR.startDay, -1);
    expect(curatedDailySeed(before)).toBe(dailySeed(before));
  });

  it('takvim SONRASI (bitince) günler FORMÜLE düşer (yedek)', () => {
    const after = addDays(DAILY_CALENDAR.startDay, DAILY_CALENDAR.seeds.length + 5);
    expect(curatedDailySeed(after)).toBe(dailySeed(after));
  });

  it('belirleyici: aynı gün → aynı tohum', () => {
    const day = addDays(DAILY_CALENDAR.startDay, 42);
    expect(curatedDailySeed(day)).toBe(curatedDailySeed(day));
  });

  // NOT: istemci TS takvimi ↔ sunucu daily_calendar.json BİREBİR paritesi
  // server/test_daily_calendar.py tarafından doğrulanır (her iki dosyayı okuyup
  // karşılaştırır). İstemci tarafında node:fs tipleri olmadığından burada değil.
});
