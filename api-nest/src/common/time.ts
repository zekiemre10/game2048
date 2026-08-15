/** Zaman yardımcıları — app.py int(time.time()) ve UTC ay/gün anahtarları. */

/** Unix saniye (app.py'deki tüm timestamp'ler). */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** UTC ay anahtarı "YYYY-MM" (app.py utc_month). */
export function utcMonth(ts: number = nowSec()): string {
  const d = new Date(ts * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** UTC gün anahtarı "YYYY-MM-DD" (app.py utc_day). */
export function utcDay(ts: number = nowSec()): string {
  const d = new Date(ts * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
