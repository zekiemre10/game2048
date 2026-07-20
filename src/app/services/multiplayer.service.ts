import { Injectable, computed, inject, signal } from '@angular/core';
import { API_BASE, AuthService } from './auth.service';
import { GameService } from './game.service';
import { GameStatus } from '../models/tile.model';

// ============================================================
//  2048 — Çok oyunculu yarış servisi
//  Oda kur / kodla katıl / host başlatır / canlı skor tablosu.
//  Ortak tohum (seed) ile herkes aynı taşları alır (adil yarış).
//  Gerçek zamana yakın: oda durumu ~1.2sn'de bir yoklanır.
// ============================================================

export interface RoomPlayer {
  id: number;
  username: string;
  score: number;
  best: number;
  done: boolean;
}

export interface RoomState {
  code: string;
  hostId: number;
  status: 'lobby' | 'racing' | 'finished';
  seed: number;
  duration: number;
  startedAt: number | null;
  now: number;
  players: RoomPlayer[];
}

export type MpResult = { ok: boolean; error?: string };

@Injectable({ providedIn: 'root' })
export class MultiplayerService {
  private readonly auth = inject(AuthService);
  private readonly game = inject(GameService);

  readonly room = signal<RoomState | null>(null);
  readonly busy = signal(false);
  /** Hata/bilgi anahtarı (mp.err.*), yoksa ''. */
  readonly notice = signal('');

  readonly inRoom = computed(() => this.room() !== null);
  readonly status = computed(() => this.room()?.status ?? null);
  readonly isHost = computed(
    () => this.room()?.hostId === this.auth.user()?.id,
  );
  readonly players = computed(() => this.room()?.players ?? []);

  private loopOn = false;
  private raceStarted = false;

  /** Oda kur (host). */
  async createRoom(duration = 180): Promise<MpResult> {
    return this.enter('/rooms/create', { duration });
  }

  /** Kodla katıl. */
  async joinRoom(code: string): Promise<MpResult> {
    return this.enter('/rooms/join', { code: code.trim().toUpperCase() });
  }

  private async enter(path: string, body: unknown): Promise<MpResult> {
    const headers = this.auth.authHeaders();
    if (!headers) return { ok: false, error: 'unauthorized' };
    this.busy.set(true);
    this.notice.set('');
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: j.error || 'error' };
      this.raceStarted = false;
      this.room.set(j.room);
      this.startLoop();
      return { ok: true };
    } catch {
      return { ok: false, error: 'network' };
    } finally {
      this.busy.set(false);
    }
  }

  /** Yarışı başlat (yalnızca host). */
  async startRace(): Promise<MpResult> {
    const room = this.room();
    const headers = this.auth.authHeaders();
    if (!room || !headers) return { ok: false, error: 'error' };
    try {
      const res = await fetch(`${API_BASE}/rooms/start`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: room.code }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: j.error || 'error' };
      this.applyRoom(j.room);
      return { ok: true };
    } catch {
      return { ok: false, error: 'network' };
    }
  }

  /** Odadan ayrıl. */
  async leaveRoom(): Promise<void> {
    const room = this.room();
    const headers = this.auth.authHeaders();
    this.loopOn = false;
    this.raceStarted = false;
    this.room.set(null);
    this.notice.set('');
    if (room && headers) {
      try {
        await fetch(`${API_BASE}/rooms/leave`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: room.code }),
        });
      } catch {
        /* sessiz */
      }
    }
  }

  // --- İç döngü ----------------------------------------------

  private startLoop(): void {
    if (this.loopOn) return;
    this.loopOn = true;
    const tick = async () => {
      if (!this.loopOn) return;
      await this.poll();
      if (this.loopOn) setTimeout(tick, 1200);
    };
    setTimeout(tick, 1000);
  }

  /** Oda durumunu yokla; yarıştaysan ilerlemeni de gönder. */
  private async poll(): Promise<void> {
    const room = this.room();
    const headers = this.auth.authHeaders();
    if (!room || !headers) return;
    try {
      let updated: RoomState | null = null;
      if (room.status === 'racing' && this.raceStarted) {
        // İlerleme gönder — yanıt güncel oda durumudur
        const res = await fetch(`${API_BASE}/rooms/progress`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: room.code,
            score: this.game.score(),
            best: this.game.bestTile(),
            done: this.game.status() !== GameStatus.Playing,
          }),
        });
        if (res.ok) updated = (await res.json()).room;
      } else {
        const res = await fetch(
          `${API_BASE}/rooms/state?code=${room.code}`,
          { headers },
        );
        if (res.status === 404) {
          // Oda kapandı (host ayrıldı)
          this.loopOn = false;
          this.room.set(null);
          this.notice.set('mp.err.room_closed');
          return;
        }
        if (res.ok) updated = (await res.json()).room;
      }
      if (updated) this.applyRoom(updated);
    } catch {
      /* çevrimdışı — sessiz */
    }
  }

  /** Yeni oda durumunu uygula + geçişleri işle (lobi→yarış). */
  private applyRoom(next: RoomState): void {
    this.room.set(next);
    if (next.status === 'racing' && !this.raceStarted) {
      this.raceStarted = true;
      const now = next.now;
      const started = next.startedAt ?? now;
      const remaining = Math.max(2, next.duration - (now - started));
      this.game.startRace(next.seed, remaining);
    }
  }
}
