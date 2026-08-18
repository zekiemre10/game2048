import { Injectable, computed, inject, signal } from '@angular/core';
import { API_BASE, AuthService } from './auth.service';
import { GameService } from './game.service';
import { BOARD_SIZE, GameMode, GameStatus } from '../models/tile.model';
import { AiLevel, BotCharacterId, isAiLevel, isBotCharacter } from '../logic/ai';

// ============================================================
//  2048 — Çok oyunculu yarış servisi
//  Oda kur / kodla katıl / host başlatır / canlı skor tablosu.
//  Ortak tohum (seed) ile herkes aynı taşları alır (adil yarış).
//  Gerçek zamana yakın: oda durumu ~1.2sn'de bir yoklanır.
//
//  NOT: Botlar artık SUNUCUDA koşar (adil, kararlı, manipüle edilemez). İstemci
//  bot çalıştırmaz; skorları oda durumunda sunucudan gelir. (Eski host-tarayıcı
//  botu ve /rooms/botprogress kaldırıldı.)
// ============================================================

export interface RoomPlayer {
  id: number;
  username: string;
  score: number;
  best: number;
  done: boolean;
  isBot?: boolean;
  /** Bot KARAKTERİ (yeni: corner/space/…) VERİ olarak. İnsanlarda/eski botlarda tanımsız. */
  character?: BotCharacterId;
  /** Eski zorluk botu VERİ olarak (geriye dönük). Karakter botlarında/insanlarda tanımsız. */
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
  /** Yönetici bu odayı kapattı mı (izleme paneli müdahalesi). */
  adminClosed?: boolean;
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
  readonly isHost = computed(() => this.room()?.hostId === this.auth.user()?.id);
  readonly players = computed(() => this.room()?.players ?? []);

  private loopOn = false;
  private raceStarted = false;
  /** Karakter galibiyeti YALNIZCA bir kez kaydedilsin diye biten oda kodu. */
  private recordedFinishCode: string | null = null;

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
      this.recordedFinishCode = null;
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

  /**
   * Odaya YZ botu ekle (yalnızca host, lobide). Bot SUNUCUDA koşacak; seviyesi
   * sunucuya veri olarak gider ve oda durumunda `level` alanı olarak döner.
   */
  async addBot(difficulty: AiLevel = 'medium'): Promise<MpResult> {
    // Zorluğu İSTEMCİDE de doğrula (sunucu da doğrular) — geçersiz kademe gitmesin.
    if (!isAiLevel(difficulty)) return { ok: false, error: 'invalid_level' };
    return this.botAction('/rooms/addbot', { difficulty });
  }

  /** Odaya isimli KARAKTER botu ekle (host, lobide). Yeni galeri seçim yolu. */
  async addBotCharacter(character: BotCharacterId): Promise<MpResult> {
    if (!isBotCharacter(character)) return { ok: false, error: 'invalid_character' };
    return this.botAction('/rooms/addbot', { character });
  }

  /**
   * "Bana uygun rakip": oyuncunun 4×4 son performansına göre EŞLENEN bir bot
   * ekler (uyarlanabilir zorluk). Eşlenen rung mevcut bir kademe/karakter
   * anahtarıdır → sunucu zaten çözer. Başarılıysa yumuşatma için kaydedilir.
   * Yarış her zaman 4×4 olduğundan eşleştirme 4×4 penceresini kullanır.
   */
  async addMatchedBot(): Promise<MpResult> {
    const key = this.game.matchedRung(BOARD_SIZE);
    const r = isBotCharacter(key)
      ? await this.addBotCharacter(key)
      : isAiLevel(key)
        ? await this.addBot(key)
        : await this.addBot('medium');
    if (r.ok) this.game.commitAdaptiveKey(key);
    return r;
  }

  /** Botu çıkar (host, lobide). */
  async removeBot(botId: number): Promise<MpResult> {
    return this.botAction('/rooms/removebot', { botId });
  }

  private async botAction(path: string, extra: unknown): Promise<MpResult> {
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
    this.loopGen++; // uçuştaki yoklamaları ve yetim zamanlayıcıları geçersiz kıl
    this.raceStarted = false;
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
        // Kendi ilerlemeni gönder — yanıt güncel oda durumudur. Skoru DEĞİL,
        // HAMLE TRANSKRİPTİni gönderiyoruz: sunucu odanın tohumuyla yeniden
        // oynatıp skoru KENDİSİ hesaplar (konsoldan skor şişirme engellenir).
        // Bot skorları da sunucuda üretilir; istemci bot ilerlemesi bildirmez.
        const res = await fetch(`${API_BASE}/rooms/progress`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: room.code,
            moves: this.game.gameTranscript().moves,
            done: this.game.status() !== GameStatus.Playing,
          }),
        });
        if (res.ok) updated = (await res.json()).room;
      } else {
        const res = await fetch(`${API_BASE}/rooms/state?code=${room.code}`, { headers });
        if (res.status === 404) {
          // Oda kapandı (host ayrıldı)
          this.loopOn = false;
          this.loopGen++;
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
    // Yönetici odayı kapattıysa oyuncuya anlamlı mesaj göster (izleme paneli).
    if (next.adminClosed && !this.room()?.adminClosed) {
      this.notice.set('mp.err.adminClosed');
    }
    this.room.set(next);
    if (next.status === 'racing' && !this.raceStarted) {
      this.raceStarted = true;
      const now = next.now;
      const started = next.startedAt ?? now;
      const remaining = Math.max(2, next.duration - (now - started));
      this.game.startRace(next.seed, remaining);
    }
    // Yarış bitti → karakter bazlı galibiyeti BİR KEZ kaydet (skorca geçtiğim
    // karakterler "yenildi" sayılır). Botlar SUNUCUDA koşar; skorlar sunucudan.
    if (next.status === 'finished' && this.recordedFinishCode !== next.code) {
      this.recordedFinishCode = next.code;
      this.recordCharacterOutcomes(next);
    }
  }

  /** Biten yarışta, skorca geçtiğim her karakter botunu "yenildi" say. */
  private recordCharacterOutcomes(room: RoomState): void {
    const me = room.players.find((p) => p.id === this.auth.user()?.id);
    if (!me) return; // yarışa katılmadıysam kaydetme
    const results = room.players
      .filter((p) => p.isBot && isBotCharacter(p.character))
      .map((p) => ({ id: p.character as string, beaten: me.score > p.score }));
    this.game.recordCharacterResults(results);
  }
}
