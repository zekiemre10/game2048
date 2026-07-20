import { pickMissions, weekKey } from './missions';
import { DAILY_POOL, WEEKLY_POOL } from '../models/mission.model';

describe('görev seçimi (pickMissions)', () => {
  it('istenen sayıda görev döndürür', () => {
    expect(pickMissions(DAILY_POOL, 3, '2026-01-05').length).toBe(3);
    expect(pickMissions(WEEKLY_POOL, 3, '2026-W02').length).toBe(3);
  });

  it('aynı tohum → aynı görevler (deterministik)', () => {
    const a = pickMissions(DAILY_POOL, 3, '2026-01-05').map((m) => m.id);
    const b = pickMissions(DAILY_POOL, 3, '2026-01-05').map((m) => m.id);
    expect(a).toEqual(b);
  });

  it('farklı tohum genelde farklı seçim verir', () => {
    const a = pickMissions(DAILY_POOL, 3, '2026-01-05').map((m) => m.id).join();
    const b = pickMissions(DAILY_POOL, 3, '2026-01-06').map((m) => m.id).join();
    // Küçük havuzda çakışma olabilir ama çoğu gün farklıdır
    expect(a === b).toBe(false);
  });

  it('seçilen görevler benzersiz', () => {
    const ids = pickMissions(DAILY_POOL, 3, '2026-03-15').map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('weekKey (ISO hafta)', () => {
  it('YYYY-Www biçiminde döndürür', () => {
    expect(weekKey(new Date(2026, 0, 5))).toMatch(/^2026-W\d{2}$/);
  });

  it('aynı haftadaki günler aynı anahtarı verir', () => {
    // 2026-01-05 Pazartesi, 2026-01-08 Perşembe → aynı ISO hafta
    expect(weekKey(new Date(2026, 0, 5))).toBe(weekKey(new Date(2026, 0, 8)));
  });
});
