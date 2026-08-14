import { Injectable, inject, signal } from '@angular/core';
import { BOARD_SIZE, GameMode, GameStatus, TIME_ATTACK_SECONDS } from '../models/tile.model';
import { MAX_LEVEL, levelConfig } from '../models/level.model';
import { DAILY_DURATION, dailySeed, utcDayKey } from '../logic/daily-challenge';
import { BoardStore } from './board-store';
import { TimerService } from './timer.service';
import { AssistantStore } from './assistant-store';
import { AutoplayService } from './autoplay.service';
import { PowersService } from './powers.service';
import { ProfileService } from './profile.service';
import { GameEngine } from './game-engine';

/**
 * Oyun modları + yaşam döngüsü: beş modun (Klasik/Zen/Zaman Yarışı/Seviye/Günlük)
 * kurulumu, yeniden başlatma, ana ekrana dönüş, seviye geçişleri ve geri alma.
 *
 * Durum servislerini + GameEngine'i (registerActivity) + AutoplayService'i
 * (yeni oyun başlarken gösterimi iptal) enjekte eder. Hiçbiri bunu geri
 * enjekte etmez → döngü yok (tek yön: modes → engine/autoplay/durum).
 */
@Injectable({ providedIn: 'root' })
export class ModesService {
  private readonly board = inject(BoardStore);
  private readonly timer = inject(TimerService);
  private readonly assistant = inject(AssistantStore);
  private readonly autoplay = inject(AutoplayService);
  private readonly powers = inject(PowersService);
  private readonly profile = inject(ProfileService);
  private readonly engine = inject(GameEngine);

  /** Oynanan günlük meydan okumanın gün anahtarı (sonuç gönderimi için). */
  readonly dailyDay = signal<string>('');

  /**
   * Yeni doğrulanabilir oyun kaydı: tohum + hamle kaydını BoardStore'a,
   * güç bayrağını PowersService'e sıfırlatır. Tüm start* çağırır.
   */
  private beginRecordedGame(seed: number): void {
    this.board.beginRecordedGame(seed);
    this.powers.usedThisGame.set(false);
  }

  /** Klasik (sonsuz) oyunu başlatır (geriye dönük uyumluluk). */
  startGame(size: number = BOARD_SIZE): void {
    this.startMode(GameMode.Classic, size);
  }

  /**
   * Belirtilen modu ve tahta boyutunu başlatır.
   * - Classic: süre yukarı sayar, 2048'de kazanma.
   * - Zen: süresiz, 2048'de durmaz.
   * - TimeAttack: sabit geri sayım, en yüksek skor.
   */
  startMode(mode: GameMode, size: number = BOARD_SIZE): void {
    this.beginRecordedGame(this.board.randomSeed()); // her oyun tohumlu → doğrulanabilir
    this.autoplay.cancel(); // sürüyorsa gösterimi bitir, eski durumu ATMA
    this.timer.paused.set(false);
    this.assistant.aiAssisted.set(false); // yeni oyun → temiz sayfa
    this.assistant.resetHints();
    this.assistant.resetMoveReview();
    this.board.mode.set(mode);
    this.board.boardSize.set(size);
    this.board.tiles.set([]);
    this.board.score.set(0);
    this.board.moves.set(0);
    this.board.keepPlaying.set(false);
    this.board.history.set(null);
    this.powers.clearFx();
    this.board.status.set(GameStatus.Playing);
    this.board.spawnRandomTile();
    this.board.spawnRandomTile();

    if (mode === GameMode.TimeAttack) {
      this.timer.startCountdown(TIME_ATTACK_SECONDS);
    } else if (mode === GameMode.Zen) {
      this.timer.stopTimer(); // süresiz
      this.timer.elapsedSeconds.set(0);
    } else {
      this.timer.startUp(0); // Classic: yukarı sayar
    }
    this.engine.registerActivity();
  }

  /**
   * Günlük meydan okumayı başlatır: tohum günden türetilir, herkes AYNI tahtayı
   * oynar. Yarıştan farkı tek kişilik olması ve sonucun sıralamaya gönderilmesidir.
   */
  startDaily(): void {
    const day = utcDayKey();
    this.autoplay.cancel();
    this.timer.paused.set(false);
    this.assistant.aiAssisted.set(false);
    this.assistant.resetHints();
    this.assistant.resetMoveReview();
    this.beginRecordedGame(dailySeed(day)); // tohum günden türetilir
    this.dailyDay.set(day);
    this.board.mode.set(GameMode.Daily);
    this.board.boardSize.set(BOARD_SIZE); // günlük her zaman 4×4 (adil)
    this.board.tiles.set([]);
    this.board.score.set(0);
    this.board.moves.set(0);
    this.board.keepPlaying.set(true); // 2048'de durma, süre bitene dek oyna
    this.board.history.set(null);
    this.powers.clearFx();
    this.board.status.set(GameStatus.Playing);
    this.board.spawnRandomTile();
    this.board.spawnRandomTile();
    this.timer.startCountdown(DAILY_DURATION);
    this.engine.registerActivity();
  }

  /**
   * Çok oyunculu yarışı başlatır: ortak `seed` ile tohumlu RNG → tüm oyuncular
   * birebir aynı taş dizisini alır (adil yarış). Süre bitince skor kalır.
   */
  startRace(seed: number, duration: number): void {
    this.autoplay.cancel();
    this.timer.paused.set(false);
    this.assistant.aiAssisted.set(false); // yeni yarış → temiz sayfa
    this.assistant.resetHints();
    this.assistant.resetMoveReview();
    this.beginRecordedGame(seed); // yarış: ortak tohum (herkes aynı taşlar)
    this.board.mode.set(GameMode.Race);
    this.board.boardSize.set(BOARD_SIZE); // yarış her zaman 4×4
    this.board.tiles.set([]);
    this.board.score.set(0);
    this.board.moves.set(0);
    this.board.keepPlaying.set(true); // 2048'de durma; süre bitene dek yarış
    this.board.history.set(null);
    this.powers.clearFx();
    this.board.status.set(GameStatus.Playing);
    this.board.spawnRandomTile();
    this.board.spawnRandomTile();
    this.timer.startCountdown(duration);
    this.engine.registerActivity();
  }

  /** Seviye modunu 1. seviyeden başlatır. */
  startLevelMode(): void {
    this.board.mode.set(GameMode.Level);
    this.board.level.set(1);
    this.startLevel();
    this.engine.registerActivity(); // gün serisi
  }

  /** Anlık seviyeyi (yeniden) başlatır: boş tahta + geri sayım. */
  private startLevel(): void {
    this.beginRecordedGame(this.board.randomSeed());
    this.autoplay.cancel(); // sürüyorsa gösterimi bitir, eski durumu ATMA
    this.timer.paused.set(false);
    this.assistant.aiAssisted.set(false); // yeni seviye → temiz sayfa
    this.assistant.resetHints();
    this.assistant.resetMoveReview();
    const cfg = levelConfig(this.board.level());
    this.board.boardSize.set(BOARD_SIZE); // seviye modu her zaman 4×4
    this.board.tiles.set([]);
    this.board.score.set(0);
    this.board.moves.set(0);
    this.engine.lastReward.set(0);
    this.board.keepPlaying.set(false);
    this.board.history.set(null);
    this.powers.clearFx();
    this.board.status.set(GameStatus.Playing);
    this.board.spawnRandomTile();
    this.board.spawnRandomTile();
    this.timer.startCountdown(cfg.seconds);

    // Bu seviyeye ulaşıldı → en yüksek seviyeyi güncelle (ProfileService)
    this.profile.reportBestLevel(this.board.level());
  }

  /** Ana (başlık) ekrana döner: oyunu durdurur, durumu Idle'a alır. */
  goHome(): void {
    this.autoplay.cancel(); // ana ekrana dönerken geri yüklenecek bir şey yok
    this.timer.stopTimer();
    this.timer.paused.set(false);
    this.board.clearRng();
    this.board.status.set(GameStatus.Idle);
  }

  /** Mevcut modu ve boyutu yeniden başlatır (Yeni Oyun / Baştan). */
  restartCurrent(): void {
    // Yarışta "Yeni Oyun" YOK: tohumlu yarışı bozar. Günlük: aynı günün tahtası.
    if (this.board.mode() === GameMode.Race) return;
    if (this.board.mode() === GameMode.Daily) {
      this.startDaily();
      return;
    }
    if (this.board.mode() === GameMode.Level) {
      this.startLevelMode();
    } else {
      this.startMode(this.board.mode(), this.board.boardSize());
    }
  }

  /** Seviye başarısız olunca aynı seviyeyi tekrar dener. */
  retryLevel(): void {
    if (this.board.mode() !== GameMode.Level) return;
    this.startLevel();
  }

  /** Seviye tamamlanınca bir sonraki seviyeye geçer. */
  nextLevel(): void {
    if (this.board.status() !== GameStatus.LevelComplete) return;
    if (this.board.level() >= MAX_LEVEL) return; // zaten son seviye
    this.board.level.update((l) => l + 1);
    this.startLevel();
  }

  /** Oyunu başlık ekranına döndürür (durumu tamamen sıfırlar). */
  reset(): void {
    this.board.tiles.set([]);
    this.board.score.set(0);
    this.board.moves.set(0);
    this.board.keepPlaying.set(false);
    this.board.history.set(null);
    this.board.status.set(GameStatus.Idle);
    this.board.mode.set(GameMode.Classic);
    this.board.boardSize.set(BOARD_SIZE);
    this.board.level.set(1);
    this.powers.clearFx();
    this.timer.stopTimer();
    this.timer.elapsedSeconds.set(0);
    this.timer.remainingSeconds.set(0);
  }

  /**
   * Son hamleyi geri alır (tek adım). Oyun bittiyse de çalışır (kaybettiren
   * hamle geri alınabilir). Tohumlu modlarda (yarış + günlük) geri alma YOK.
   * @returns geri alma yapıldıysa true.
   */
  undo(): boolean {
    if (this.board.mode() === GameMode.Race || this.board.mode() === GameMode.Daily) {
      return false;
    }
    const snapshot = this.board.history();
    if (!snapshot) return false;

    // Animasyon bayraklarını temizleyerek geri yükle (pop/bump tekrar oynamasın)
    this.board.tiles.set(
      snapshot.tiles.map((t) => ({ id: t.id, value: t.value, row: t.row, col: t.col })),
    );
    this.board.score.set(snapshot.score);
    this.board.moves.set(snapshot.moves);
    this.board.keepPlaying.set(snapshot.keepPlayingAfterWin);
    this.board.status.set(snapshot.status);
    this.board.history.set(null); // tek adımlık geçmiş

    // Biten oyun geri alma ile yeniden oynanır hâle geldiyse sayaç da sürsün.
    if (snapshot.status === GameStatus.Playing) this.timer.resumeForMode();
    return true;
  }
}
