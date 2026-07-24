import { Injectable, inject, signal } from '@angular/core';
import { API_BASE, AuthService } from './auth.service';
import { utcDayKey } from '../logic/daily-challenge';

// ============================================================
//  2048 — Günlük meydan okuma servisi
//  Herkes o gün aynı tahtayı oynar; sonuç sunucuya gönderilir ve
//  günlük sıralama getirilir. En iyi skor sayılır (tekrar oynanabilir).
// ============================================================

export interface DailyRow {
  id: number;
  username: string;
  score: number;
  best: number;
  moves: number;
  rank: number;
}

@Injectable({ providedIn: 'root' })
export class DailyService {
  private readonly auth = inject(AuthService);

  readonly rows = signal<DailyRow[]>([]);
  readonly myRow = signal<DailyRow | null>(null);
  readonly players = signal(0);
  readonly loading = signal(false);
  readonly error = signal('');

  /** Bugün oynanan gün anahtarı (arayüzde gösterilir). */
  readonly today = signal<string>(utcDayKey());

  private seq = 0;

  /** Günlük sıralamayı getir. */
  async load(): Promise<void> {
    const headers = this.auth.authHeaders();
    this.error.set('');
    this.today.set(utcDayKey());
    if (!headers) {
      this.rows.set([]);
      this.myRow.set(null);
      this.error.set('daily.err.login');
      return;
    }
    const seq = ++this.seq;
    this.loading.set(true);
    try {
      const res = await fetch(`${API_BASE}/daily`, { headers });
      const j = await res.json().catch(() => ({}));
      if (seq !== this.seq) return;
      if (!res.ok) {
        this.error.set(`daily.err.${j.error || 'error'}`);
        return;
      }
      this.rows.set(j.top ?? []);
      this.myRow.set(j.me ?? null);
      this.players.set(j.players ?? 0);
      if (j.day) this.today.set(j.day);
    } catch {
      if (seq === this.seq) this.error.set('daily.err.network');
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }

  /**
   * Günün sonucunu gönderir. Sunucu yalnızca ÖNCEKİNDEN İYİYSE kaydeder,
   * gün anahtarını da kendisi belirler (geçmişe skor yazılamaz).
   * @returns sonuç iyileştiyse true
   */
  async submit(score: number, best: number, moves: number): Promise<boolean> {
    const headers = this.auth.authHeaders();
    if (!headers) return false;
    try {
      const res = await fetch(`${API_BASE}/daily/submit`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, best, moves }),
      });
      if (!res.ok) return false;
      const j = await res.json().catch(() => ({}));
      return !!j.improved;
    } catch {
      return false;
    }
  }
}
