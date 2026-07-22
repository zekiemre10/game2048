import { Injectable, computed, inject, signal } from '@angular/core';
import { API_BASE, AuthService } from './auth.service';

// ============================================================
//  2048 — Arkadaşlar servisi
//  İstek gönder / kabul-ret / listele / ara / çıkar.
//  Backend: /friends, /friends/request, /friends/respond,
//           /friends/remove, /users/search
// ============================================================

export interface Friend {
  id: number;
  username: string;
  bestScore: number;
  bestLevel: number;
  bestTile: number;
  reqId?: number; // gelen/giden isteklerde ilişki kimliği
}

export interface UserHit {
  id: number;
  username: string;
}

export type RequestResult = { ok: boolean; error?: string; status?: string };

@Injectable({ providedIn: 'root' })
export class FriendsService {
  private readonly auth = inject(AuthService);

  readonly friends = signal<Friend[]>([]);
  readonly incoming = signal<Friend[]>([]);
  readonly outgoing = signal<Friend[]>([]);

  /** Arama sonuçları + durum. */
  readonly searchResults = signal<UserHit[]>([]);
  readonly searching = signal(false);

  /** Bekleyen gelen istek sayısı (rozet için). */
  readonly incomingCount = computed(() => this.incoming().length);

  private polling = false;

  /** Arkadaş verisini sunucudan çek (giriş varsa). */
  async refresh(): Promise<void> {
    const headers = this.auth.authHeaders();
    if (!headers) {
      this.friends.set([]);
      this.incoming.set([]);
      this.outgoing.set([]);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/friends`, { headers });
      if (!res.ok) return;
      const j = await res.json();
      this.friends.set(j.friends ?? []);
      this.incoming.set(j.incoming ?? []);
      this.outgoing.set(j.outgoing ?? []);
    } catch {
      /* çevrimdışı — sessiz */
    }
  }

  /**
   * Arama sıra numarası: her tuş vuruşunda istek atıldığından yanıtlar
   * sırasız dönebilir. Yalnızca EN SON isteğin yanıtı uygulanır; aksi
   * hâlde "an" yanıtı geç gelip "anna" sonuçlarını eziyordu.
   */
  private searchSeq = 0;

  /** Kullanıcı ara (en az 2 karakter). */
  async search(q: string): Promise<void> {
    const headers = this.auth.authHeaders();
    const term = q.trim();
    const seq = ++this.searchSeq;
    if (!headers || term.length < 2) {
      this.searchResults.set([]);
      this.searching.set(false);
      return;
    }
    this.searching.set(true);
    try {
      const res = await fetch(
        `${API_BASE}/users/search?q=${encodeURIComponent(term)}`,
        { headers },
      );
      const j = await res.json().catch(() => ({}));
      if (seq !== this.searchSeq) return; // daha yeni bir arama var
      this.searchResults.set(res.ok ? (j.users ?? []) : []);
    } catch {
      if (seq === this.searchSeq) this.searchResults.set([]);
    } finally {
      if (seq === this.searchSeq) this.searching.set(false);
    }
  }

  clearSearch(): void {
    this.searchResults.set([]);
  }

  /** İstek gönder (kullanıcı adı ya da id ile). */
  async requestFriend(target: { username?: string; id?: number }): Promise<RequestResult> {
    const r = await this.post('/friends/request', target);
    if (r.ok) await this.refresh();
    return r;
  }

  /** Gelen isteği yanıtla. */
  async respond(reqId: number, accept: boolean): Promise<RequestResult> {
    const r = await this.post('/friends/respond', { id: reqId, accept });
    if (r.ok) await this.refresh();
    return r;
  }

  /** Arkadaşlıktan çıkar. */
  async remove(userId: number): Promise<RequestResult> {
    const r = await this.post('/friends/remove', { id: userId });
    if (r.ok) await this.refresh();
    return r;
  }

  private async post(path: string, body: unknown): Promise<RequestResult> {
    const headers = this.auth.authHeaders();
    if (!headers) return { ok: false, error: 'unauthorized' };
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      return res.ok
        ? { ok: true, status: j.status }
        : { ok: false, error: j.error || 'error' };
    } catch {
      return { ok: false, error: 'network' };
    }
  }

  /** Arka planda periyodik yenileme (giriş varken rozet + liste güncel kalsın). */
  startPolling(intervalMs = 8000): void {
    if (this.polling) return;
    this.polling = true;
    const tick = async () => {
      if (!this.polling) return;
      if (this.auth.authHeaders()) await this.refresh();
      if (this.polling) setTimeout(tick, intervalMs);
    };
    setTimeout(tick, intervalMs);
  }
}
