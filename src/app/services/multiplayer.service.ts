import { Injectable, computed, inject, signal } from '@angular/core';
import { API_BASE, AuthService } from './auth.service';
import { GameService } from './game.service';
import { GameMode, GameStatus } from '../models/tile.model';
import { AiLevel, isAiLevel } from '../logic/ai';
import { BotRunner, resolveBotLevel } from '../logic/bot-runner';

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
  isBot?: boolean;
  /** Bot zorluğu VERİ olarak (sunucudan). İnsanlarda tanımsız. */
  level?: AiLevel;
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
  /** Host'un çalıştırdığı botlar (botId → koşucu). */
  private bots = new Map<number, BotRunner>();
  private botsStarted = false;
  /**
   * Host'un eklerken kaydettiği bot seviyeleri (botId → seviye). Sunucu oda
   * durumunda `level` alanını taşır; bu harita yalnızca o alan gelene kadar
   * (dağıtım penceresi / eski oda) KÖPRÜdür — seviye asla isimden çözülmez.
   */
  private botLevels = new Map<number, AiLevel>();

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
      this.stopBots();
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

  /** Odaya YZ botu ekle (yalnızca host, lobide). */
  async addBot(difficulty: AiLevel = 'medium'): Promise<MpResult> {
    // Zorluğu İSTEMCİDE de doğrula (sunucu da doğrular) — geçersiz kademe gitmesin.
    if (!isAiLevel(difficulty)) return { ok: false, error: 'invalid_level' };
    const res = await this.botAction('/rooms/addbot', { difficulty });
    // Sunucu eklenen botun kimliğini döndürür → seviyesini VERİ olarak kaydet
    // (isimden çözmek yerine). Sunucu artık level'i oda durumunda da taşıyor;
    // bu kayıt yalnızca o alan gelene kadar köprü olarak durur.
    if (res.ok && typeof res.body?.['botId'] === 'number') {
      this.botLevels.set(res.body['botId'] as number, difficulty);
    }
    return { ok: res.ok, error: res.error };
  }

  /** Botu çıkar (host, lobide). */
  async removeBot(botId: number): Promise<MpResult> {
    const res = await this.botAction('/rooms/removebot', { botId });
    if (res.ok) this.botLevels.delete(botId);
    return { ok: res.ok, error: res.error };
  }

  private async botAction(
    path: string,
    extra: unknown,
  ): Promise<MpResult & { body?: Record<string, unknown> }> {
    const room = this.room();
    const headers = this.auth.authHeaders();
    if (!room || !headers) return { ok: false, error: 'error' };
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: room.code, ...(extra as object) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: j.error || 'error' };
      if (j.room) this.room.set(j.room);
      return { ok: true, body: j };
    } catch {
      return { ok: false, error: 'network' };
    }
  }

  /** Tüm botları durdurur ve temizler. */
  private stopBots(): void {
    for (const bot of this.bots.values()) bot.stop();
    this.bots.clear();
    this.botLevels.clear();
    this.botsStarted = false;
  }

  /** Odadan ayrıl. */
  async leaveRoom(): Promise<void> {
    const room = this.room();
    const headers = this.auth.authHeaders();
    this.loopOn = false;
    this.loopGen++; // uçuştaki yoklamaları ve yetim zamanlayıcıları geçersiz kıl
    this.raceStarted = false;
    this.stopBots();
    this.room.set(null);
    this.notice.set('');
    this.endRaceGame(); // yarıştan çıkıldıysa sayaç boşuna işlemesin
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

  /**
   * Döngü kuşağı. Odadan çıkıp 1.2sn içinde tekrar girilirse eski
   * zamanlayıcı hâlâ kuruludur; kuşak numarası eşleşmeyince kendini
   * sonlandırır. Aksi hâlde her giriş/çıkışta bir yoklama döngüsü daha
   * birikirdi (istek sayısı katlanır).
   */
  private loopGen = 0;

  /** Yarış devam ediyorsa oyunu bitir (oda kapandı / çıkıldı). */
  private endRaceGame(): void {
    if (this.game.mode() === GameMode.Race) this.game.goHome();
  }

  private startLoop(): void {
    if (this.loopOn) return;
    this.loopOn = true;
    const gen = ++this.loopGen;
    const alive = () => this.loopOn && gen === this.loopGen;
    const tick = async () => {
      if (!alive()) return;
      await this.poll(gen);
      if (alive()) setTimeout(tick, 1200);
    };
    setTimeout(tick, 1000);
  }

  /** Oda durumunu yokla; yarıştaysan ilerlemeni de gönder. */
  private async poll(gen: number): Promise<void> {
    const room = this.room();
    const headers = this.auth.authHeaders();
    if (!room || !headers) return;
    try {
      let updated: RoomState | null = null;
      if (room.status === 'racing' && this.raceStarted) {
        // Host: bot ilerlemelerini bildir
        if (this.isHost() && this.bots.size > 0) {
          for (const [botId, bot] of this.bots) {
            fetch(`${API_BASE}/rooms/botprogress`, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                code: room.code,
                botId,
                score: bot.score,
                best: bot.best,
                done: bot.done,
              }),
            }).catch(() => {});
          }
        }
        // Kendi ilerlemeni gönder — yanıt güncel oda durumudur
        const res = await fetch(`${API_BASE}/rooms/progress`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: room.code,
            score: this.game.score(),
            best: this.game.currentBestTile(), // bu yarıştaki en yüksek kare
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
          this.loopGen++;
          this.stopBots();
          this.raceStarted = false;
          this.room.set(null);
          this.notice.set('mp.err.room_closed');
          // Yarış ortada kalmasın: sayacı durdur, ana ekrana dön.
          this.endRaceGame();
          return;
        }
        if (res.ok) updated = (await res.json()).room;
      }
      // Bekleme sırasında odadan çıkılmış olabilir: geç gelen yanıt
      // ayrılınan odayı diriltmemeli (hatta yarışa sokmamalı).
      if (gen !== this.loopGen || !this.loopOn) return;
      if (this.room()?.code !== room.code) return;
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
    // Host: yarış başladıysa botları çalıştır (aynı tohumla, adil).
    if (next.status === 'racing' && this.isHost() && !this.botsStarted) {
      this.botsStarted = true;
      for (const p of next.players) {
        if (p.isBot) {
          // Seviye VERİDEN: sunucunun p.level alanı, yoksa ekleme anında
          // kaydedilen seviye, o da yoksa güvenli varsayılan (isimden ASLA).
          const level = resolveBotLevel(p.level, this.botLevels.get(p.id));
          const bot = new BotRunner(next.seed, level);
          bot.start();
          this.bots.set(p.id, bot);
        }
      }
    }
    if (next.status === 'finished' && this.bots.size > 0) {
      this.stopBots();
    }
  }
}
