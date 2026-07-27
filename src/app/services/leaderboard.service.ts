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

export type LeaderScope = 'monthly' | 'global' | 'friends';

/** Ay sonu şampiyonluk ödülü (sunucudan gelir). */
export interface ChampionPrize {
  month: string;
  score: number;
  gold: number;
  powers: Record<string, number>;
}

@Injectable({ providedIn: 'root' })
export class LeaderboardService {
  private readonly auth = inject(AuthService);

  readonly rows = signal<LeaderRow[]>([]);
  readonly myRow = signal<LeaderRow | null>(null);
  readonly loading = signal(false);
  readonly scope = signal<LeaderScope>('monthly');
  readonly error = signal('');

  /** Gösterilen ay (`YYYY-MM`) — aylık sekmede doldurulur. */
  readonly month = signal('');

  /** Alınmamış şampiyonluk ödülü (varsa). */
  readonly prize = signal<ChampionPrize | null>(null);

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
      this.month.set(j.month ?? '');
      this.prize.set(j.prize ?? null);
    } catch {
      if (seq === this.seq) this.error.set('lb.err.network');
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }

  /**
   * Bu ayki skoru bildirir (oyun bitince/yarıda bırakınca çağrılır).
   * Skoru İSTEMCİ HESAPLAMAZ: tohum + hamle dizisi gönderilir, sunucu
   * oyunu yeniden oynatıp skoru kendisi bulur (hile önleme). `score`
   * yalnızca sunucunun kıyas/kayıt için görebilmesi amacıyla eklenir.
   */
  async submitMonthly(
    transcript: { seed: number; moves: string; size: number },
    score: number,
  ): Promise<void> {
    const headers = this.auth.authHeaders();
    if (!headers || !transcript.moves) return;
    try {
      await fetch(`${API_BASE}/monthly/submit`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...transcript, score }),
      });
    } catch {
      /* çevrimdışı — sessiz */
    }
  }

  /**
   * Bekleyen şampiyonluk ödülünü alır.
   * @returns ödül içeriği (altın + güçler) ya da null
   */
  async claimPrize(): Promise<ChampionPrize | null> {
    const headers = this.auth.authHeaders();
    if (!headers) return null;
    try {
      const res = await fetch(`${API_BASE}/monthly/claim`, {
        method: 'POST',
        headers,
      });
      if (!res.ok) return null;
      const j = await res.json();
      this.prize.set(null);
      return j as ChampionPrize;
    } catch {
      return null;
    }
  }
}
