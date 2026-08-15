import { fnvSeed } from '../replay/replay';
import calendar from './daily_calendar.json';

// ============================================================
//  Günlük tohum — app.py daily_seed birebir. KÜRATÖRLÜ takvimde varsa
//  oradan, yoksa FNV-1a formül yedeği. İstemci curatedDailySeed ile aynı;
//  aksi hâlde oyuncunun transkripti replay'de tutmaz.
// ============================================================

const START_DAY: string | null =
  calendar && typeof calendar.startDay === 'string' ? calendar.startDay : null;
const SEEDS: number[] = Array.isArray((calendar as any)?.seeds)
  ? (calendar as any).seeds.map((s: any) => Number(s) | 0)
  : [];

function dayIndex(day: string, start: string): number | null {
  const d0 = Date.parse(start + 'T00:00:00Z');
  const d1 = Date.parse(day + 'T00:00:00Z');
  if (Number.isNaN(d0) || Number.isNaN(d1)) return null;
  return Math.round((d1 - d0) / 86400000);
}

/** app.py daily_seed(day): takvim → formül yedeği. */
export function dailySeed(day: string): number {
  if (START_DAY && SEEDS.length) {
    const i = dayIndex(day, START_DAY);
    if (i !== null && i >= 0 && i < SEEDS.length) return SEEDS[i];
  }
  return fnvSeed(day);
}
