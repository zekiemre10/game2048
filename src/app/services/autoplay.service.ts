import { Injectable, inject } from '@angular/core';
import { GameStatus } from '../models/tile.model';
import { AiLevel, bestMove } from '../logic/ai';
import { BoardStore, GameSnapshot } from './board-store';
import { TimerService } from './timer.service';
import { AssistantStore } from './assistant-store';
import { PowersService } from './powers.service';
import { GameEngine } from './game-engine';

/**
 * YZ gösterimi öncesi tam oyun durumu. `GameSnapshot`ten farkı: süre sayaçlarını
 * ve öneri hakkını da taşır (gösterim oyuncunun süresini/haklarını tüketmemeli).
 */
interface AiDemoSnapshot extends GameSnapshot {
  history: GameSnapshot | null;
  elapsedSeconds: number;
  remainingSeconds: number;
  countdownTotal: number;
  assistHintsLeft: number;
}

/**
 * Otomatik oynatma ("YZ'yi izle") MOTORU: mevcut tahtadan devam ederek YZ
 * hamleleri yapar, durdurulunca oyuncunun tam durumunu geri yükler.
 *
 * GameEngine'i (move) + durum servislerini enjekte eder; hiçbiri bunu geri
 * enjekte etmediğinden döngü yoktur. Mod kurulumu `cancelAutoplay` ile bunu
 * çağırır (tek yön: modes → autoplay → engine/durum).
 */
@Injectable({ providedIn: 'root' })
export class AutoplayService {
  private readonly board = inject(BoardStore);
  private readonly timer = inject(TimerService);
  private readonly assistant = inject(AssistantStore);
  private readonly powers = inject(PowersService);
  private readonly engine = inject(GameEngine);

  private preAiSnapshot: AiDemoSnapshot | null = null;
  private demoNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  private autoplayTimer: ReturnType<typeof setTimeout> | null = null;
  private autoplayLevel: AiLevel = 'expert';
  /** İki YZ hamlesi arası bekleme (ms) — izlenebilir olsun diye. */
  private autoplaySpeed = 400;

  /** YZ otomatik oynatmayı başlat/durdur. */
  toggle(level: AiLevel = 'expert'): void {
    if (this.assistant.autoplaying()) this.stop();
    else this.start(level);
  }

  /** YZ gösterimini başlatır (mevcut tahtadan devam ederek oynar). */
  start(level: AiLevel = 'expert'): void {
    if (this.assistant.autoplaying()) return;
    if (this.board.status() !== GameStatus.Playing) return;

    // Oyuncunun durumunu sakla — gösterim bitince aynen geri yüklenecek.
    this.preAiSnapshot = {
      tiles: this.board.tiles().map((t) => ({ ...t })),
      score: this.board.score(),
      moves: this.board.moves(),
      status: this.board.status(),
      keepPlayingAfterWin: this.board.keepPlaying(),
      history: this.board.history(),
      elapsedSeconds: this.timer.elapsedSeconds(),
      remainingSeconds: this.timer.remainingSeconds(),
      countdownTotal: this.timer.countdownTotal,
      assistHintsLeft: this.assistant.assistHintsLeft(),
    };

    // Sayacı DONDUR: gösterim oyuncunun saatiyle oynanmaz (aksi hâlde süre
    // gösterim sırasında bitip oyun-sonu ekranını bir an gösterebilir).
    this.timer.stopTimer();

    this.assistant.aiDemoResult.set(null);
    this.autoplayLevel = level;
    this.assistant.autoplaying.set(true);
    this.step();
  }

  /** Gösterimi durdurur ve oyuncunun kendi oyununu geri yükler. */
  stop(): void {
    const wasPlaying = this.assistant.autoplaying();
    this.haltTimer();
    if (wasPlaying) this.restorePreAi();
  }

  /**
   * Gösterimi iptal eder ve kaydı ATAR (geri yükleme yok). Yeni oyun başlarken
   * kullanılır: eski oyunun durumu geri gelmemeli.
   */
  cancel(): void {
    this.haltTimer();
    this.preAiSnapshot = null;
    this.assistant.aiDemoResult.set(null);
  }

  private haltTimer(): void {
    this.assistant.autoplaying.set(false);
    if (this.autoplayTimer !== null) {
      clearTimeout(this.autoplayTimer);
      this.autoplayTimer = null;
    }
  }

  /** Oyuncunun gösterim öncesi durumunu geri yükler. */
  private restorePreAi(): void {
    const snap = this.preAiSnapshot;
    this.preAiSnapshot = null;
    if (!snap) return;

    const aiScore = this.board.score(); // gösterimde YZ'nin ulaştığı skor

    // Animasyon bayraklarını temizleyerek geri yükle (geri-al ile aynı).
    this.board.tiles.set(
      snap.tiles.map((t) => ({ id: t.id, value: t.value, row: t.row, col: t.col })),
    );
    this.board.score.set(snap.score);
    this.board.moves.set(snap.moves);
    this.board.keepPlaying.set(snap.keepPlayingAfterWin);
    this.board.history.set(snap.history);
    this.board.status.set(snap.status);
    this.assistant.assistHintsLeft.set(snap.assistHintsLeft);
    this.assistant.assistHintDir.set(null);
    this.powers.clearFx();

    // Süre de geri gelir: gösterim oyuncunun süresini yemez.
    this.timer.restore(snap.elapsedSeconds, snap.remainingSeconds, snap.countdownTotal);
    if (snap.status === GameStatus.Playing && !this.timer.paused()) {
      this.timer.resumeForMode();
    }

    // YZ'nin oynadığı her şey atıldı → oyuncu avantaj devralmıyor.
    this.assistant.aiAssisted.set(false);

    this.assistant.aiDemoResult.set(aiScore);
    if (typeof setTimeout !== 'undefined') {
      if (this.demoNoticeTimer) clearTimeout(this.demoNoticeTimer);
      this.demoNoticeTimer = setTimeout(() => this.assistant.aiDemoResult.set(null), 5000);
    }
  }

  /** Otomatik oynatma hızını ayarla (ms/hamle). */
  setSpeed(ms: number): void {
    this.autoplaySpeed = Math.max(120, Math.min(1200, ms));
  }

  /** Tek YZ hamlesi + bir sonrakini zamanla. */
  private step(): void {
    if (!this.assistant.autoplaying()) return;
    if (this.board.status() !== GameStatus.Playing) {
      this.stop();
      return;
    }
    if (typeof setTimeout === 'undefined') return;
    if (this.timer.paused()) {
      this.autoplayTimer = setTimeout(() => this.step(), 200); // duraklatıldı → bekle
      return;
    }
    const dir = bestMove(this.board.toValueGrid(), this.autoplayLevel);
    if (!dir) {
      this.stop();
      return;
    }
    // Gösterim boyunca ilerleme sayılmaz (geri yükleme başarısız olsa bile
    // oyuncu YZ'nin tahtasından avantaj devralmasın).
    this.assistant.aiAssisted.set(true);
    this.engine.move(dir);

    // YZ oyunu bitirdiyse hemen dur.
    if (this.board.status() !== GameStatus.Playing) {
      this.stop();
      return;
    }
    this.autoplayTimer = setTimeout(() => this.step(), this.autoplaySpeed);
  }
}
