import { Injectable, inject, signal } from '@angular/core';
import { API_BASE, AuthService } from './auth.service';

// ============================================================
//  2048 — Skor tablosu
//  En yüksek skora göre sıralama: genel veya yalnızca arkadaşlar.
//  Kendi sıran listede olmasan bile ayrıca döner.
// ============================================================

export interface LeaderRow {
  id: number;
  username: string;
  bestScore: number;
  bestLevel: number;
  bestTile: number;
  rank: number;
}

export type LeaderScope = 'global' | 'friends';

@Injectable({ providedIn: 'root' })
export class LeaderboardService {
  private readonly auth = inject(AuthService);

  readonly rows = signal<LeaderRow[]>([]);
  readonly myRow = signal<LeaderRow | null>(null);
  readonly loading = signal(false);
  readonly scope = signal<LeaderScope>('global');
  readonly error = signal('');

  /** Sıra numarası: geç gelen yanıt yeniyi ezmesin. */
  private seq = 0;

  async load(scope: LeaderScope = this.scope()): Promise<void> {
    const headers = this.auth.authHeaders();
    this.scope.set(scope);
    this.error.set('');
    if (!headers) {
      this.rows.set([]);
      this.myRow.set(null);
      this.error.set('lb.err.login');
      return;
    }
    const seq = ++this.seq;
    this.loading.set(true);
    try {
      const res = await fetch(`${API_BASE}/leaderboard?scope=${scope}`, {
        headers,
      });
      const j = await res.json().catch(() => ({}));
      if (seq !== this.seq) return; // daha yeni bir istek var
      if (!res.ok) {
        this.error.set(`lb.err.${j.error || 'error'}`);
        this.rows.set([]);
        this.myRow.set(null);
        return;
      }
      this.rows.set(j.top ?? []);
      this.myRow.set(j.me ?? null);
    } catch {
      if (seq === this.seq) this.error.set('lb.err.network');
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }
}
