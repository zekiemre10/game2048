import { Injectable, computed, inject, signal } from '@angular/core';
import { EconomyService } from './economy.service';
import { MissionsService } from './missions.service';
import { ProfileService } from './profile.service';
import { AchievementsService, AchievementStats } from './achievements.service';
import { RewardsService } from './rewards.service';
import { PowersService } from './powers.service';
import { BoardStore, GameSnapshot } from './board-store';
import { TimerService } from './timer.service';
import { ASSIST_HINT_QUOTA, AssistantStore } from './assistant-store';
import { GameEngine } from './game-engine';
import {
  BOARD_SIZE,
  Cell,
  Direction,
  Grid,
  GameMode,
  GameStatus,
  TIME_ATTACK_SECONDS,
  Tile,
} from '../models/tile.model';
import { hasAnyMove } from '../logic/board-logic';
import { AiLevel, ValueGrid, bestMove } from '../logic/ai';
import { DAILY_DURATION, dailySeed, utcDayKey } from '../logic/daily-challenge';
import { MAX_LEVEL, levelConfig } from '../models/level.model';
import { PowerId } from '../models/power.model';
import { MissionMetric } from '../models/mission.model';
import { AVATARS } from './game-storage';

/** Kutlama türü — GameEngine'de tanımlı; eski içe aktarımlar için yeniden dışa aç. */
export type { CelebrationKind } from './game-engine';

/** Avatar listesi kalıcılık katmanında; eski içe aktarımlar için yeniden dışa aç. */
export { AVATARS } from './game-storage';

// ============================================================
//  2048 — Oyun servisi
//  Oyunun tüm durumu Angular signal'ları ile tutulur.
//  Kaynak gerçeği (source of truth): `tiles` — tahtadaki taşların
//  listesi. `grid` bu listeden türetilen 2B görünümdür.
// ============================================================

/** Kazanma değeri. */
const WIN_VALUE = 2048;

/** +30 saniye gücünün eklediği süre. */
const TIME_POWER_SECONDS = 30;

/**
 * YZ gösterimi öncesi tam oyun durumu.
 * `GameSnapshot`ten farkı: süre sayaçlarını ve öneri hakkını da taşır,
 * çünkü gösterim oyuncunun süresini ve haklarını tüketmemeli.
 */
interface AiDemoSnapshot extends GameSnapshot {
  history: GameSnapshot | null;
  elapsedSeconds: number;
  remainingSeconds: number;
  countdownTotal: number;
  assistHintsLeft: number;
}

@Injectable({ providedIn: 'root' })
export class GameService {
  /** Altın ekonomisi ayrı serviste; buradan yalnız delege edilir (façade). */
  private readonly economy = inject(EconomyService);

  /** Görevler ayrı serviste; buradan delege edilir (façade). */
  private readonly missions = inject(MissionsService);

  /** Profil/istatistik/rekorlar ayrı serviste; buradan delege edilir (façade). */
  private readonly profile = inject(ProfileService);

  /** Başarımlar ayrı serviste; koşul verisi çekirdekten geçer (façade). */
  private readonly achievements = inject(AchievementsService);

  /** Gün serisi + günlük ödül durumu ayrı serviste (façade). */
  private readonly rewards = inject(RewardsService);

  /** Güç envanteri + durumu ayrı serviste; efektler çekirdekte (façade). */
  private readonly powersSvc = inject(PowersService);

  /** Tahta durumu deposu (kernel): ham per-oyun durum + primitifler. */
  private readonly board = inject(BoardStore);

  /** Süre yönetimi ayrı serviste (yukarı sayan / geri sayım / duraklat). */
  private readonly timer = inject(TimerService);

  /** YZ asistanı durumu ayrı serviste (değerlendirme/sağlık/öneri/bayraklar). */
  private readonly assistant = inject(AssistantStore);

  /** Oyun motoru: hamle akışı + oyun-sonu + skor/başarım/görev/ödül orkestrasyonu. */
  private readonly engine = inject(GameEngine);

  // --- Durum sinyalleri (BoardStore'da; buradan delege) -------

  /** Tahtadaki taşların listesi (kaynak gerçeği). */
  readonly tiles = this.board.tiles;
  /** Anlık skor. */
  readonly score = this.board.score;
  /** Bu oyunda yapılan geçerli hamle sayısı. */
  readonly moves = this.board.moves;

  /** Bu oyunda geçen süre (saniye) — TimerService'te. */
  readonly elapsedSeconds = this.timer.elapsedSeconds;

  /** (Geri sayımlı modlar) kalan süre (saniye) — TimerService'te. */
  readonly remainingSeconds = this.timer.remainingSeconds;

  /** En yüksek skor (localStorage'dan yüklenir, değişince kaydedilir). */
  readonly bestScore = this.profile.bestScore;

  /** Oyunun anlık durumu. */
  readonly status = this.board.status;
  /** Oyun modu (klasik / seviye / zen / zaman yarışı). */
  readonly mode = this.board.mode;
  /** Anlık tahta boyutu (NxN). Seviye modu her zaman 4. */
  readonly boardSize = this.board.boardSize;
  /** (Seviye modu) anlık seviye. */
  readonly level = this.board.level;

  /** Ulaşılan en yüksek seviye (ProfileService'te). */
  readonly bestLevel = this.profile.bestLevel;

  /** Toplam altın (EconomyService'te; API sabit kalsın diye delege edilir). */
  readonly gold = this.economy.gold;

  /** Bugüne kadar kazanılan toplam altın (EconomyService'te). */
  readonly totalGoldEarned = this.economy.totalGoldEarned;

  /** Son seviye tamamlamada kazanılan altın (GameEngine'de). */
  readonly lastReward = this.engine.lastReward;

  /** Güç envanteri (PowersService'te; API sabit kalsın diye delege). */
  readonly powers = this.powersSvc.inventory;

  /** Bomba hedefleme modu açık mı? (PowersService'te) */
  readonly bombMode = this.powersSvc.bombMode;

  /** İpucu yönü (PowersService'te). */
  readonly hintDirection = this.powersSvc.hintDirection;

  /** İpucu temizleme zamanlayıcısı. */
  private hintTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Profil / istatistik (ProfileService'e delege) ----------

  /** Oyuncu adı. */
  readonly playerName = this.profile.playerName;
  /** Oynanan toplam oyun. */
  readonly gamesPlayed = this.profile.gamesPlayed;
  /** Kazanılan oyun (2048'e ulaşma / tüm seviyeler). */
  readonly gamesWon = this.profile.gamesWon;
  /** Ulaşılan en yüksek kare değeri. */
  readonly bestTile = this.profile.bestTile;
  /** Toplam yapılan hamle. */
  readonly totalMoves = this.profile.totalMoves;

  /** Gün serisi + günlük ödül durumu RewardsService'te; buradan delege. */
  readonly currentStreak = this.rewards.currentStreak;
  readonly bestStreak = this.rewards.bestStreak;
  /** Son günlük ödül miktarı (UI gösterimi için). */
  readonly lastDailyReward = this.rewards.lastDailyReward;

  /** Açılmış başarım id'leri. */
  readonly unlockedAchievements = this.achievements.unlocked;

  /** Günlük görevler (MissionsService'te; API sabit kalsın diye delege). */
  readonly dailyMissions = this.missions.daily;

  /** Haftalık görevler (MissionsService'te). */
  readonly weeklyMissions = this.missions.weekly;

  /** Alınmayı bekleyen (tamamlanmış ama alınmamış) görev sayısı. */
  readonly claimableMissions = this.missions.claimable;

  /** Kazanma yüzdesi (0-100) — ProfileService'te. */
  readonly winRate = this.profile.winRate;

  /** Bugün günlük ödül alınabilir mi? (RewardsService'te) */
  readonly canClaimDaily = this.rewards.canClaimDaily;

  /** (Seviye modu) anlık seviyenin hedef karesi (BoardStore'da). */
  readonly levelTarget = this.board.levelTarget;

  /** Son hamleden ÖNCEKİ durum (tek adımlık geçmiş; BoardStore'da). */
  private readonly history = this.board.history;

  /** Geri alınabilecek bir hamle var mı? (BoardStore'da) */
  readonly canUndo = this.board.canUndo;

  // --- Türetilmiş sinyaller (BoardStore'da; delege) -----------

  /** `tiles` listesinden üretilen NxN ızgara (okumak/çizmek için). */
  readonly grid = this.board.grid;
  /** ŞU ANKİ tahtadaki en yüksek kare (tüm zamanların rekoru değil). */
  readonly currentBestTile = this.board.currentBestTile;
  /** Boştaki hücre sayısı (hamle üretmek/oyun sonu için). */
  readonly emptyCount = this.board.emptyCount;

  /** Aktif oyunun tohumu (doğrulama transkriptinde gönderilir; BoardStore'da). */
  readonly gameSeed = this.board.gameSeed;

  /**
   * Bu oyunda GÜÇ kullanıldı mı? Kullanıldıysa oyun şampiyonluk
   * sıralamasına GİRMEZ (bomba/karıştır/geri al hamle dizisinden
   * türetilemez; ayrıca herkesin eşit şartlarda yarışması için).
   */
  readonly powerUsedThisGame = this.powersSvc.usedThisGame;

  /**
   * Yeni bir doğrulanabilir oyun kaydı başlatır: tohum + hamle kaydını
   * BoardStore'a, güç bayrağını PowersService'e sıfırlatır.
   */
  private beginRecordedGame(seed: number): void {
    this.board.beginRecordedGame(seed);
    this.powerUsedThisGame.set(false);
  }

  /** Sunucuya gönderilecek doğrulama transkripti (BoardStore'dan). */
  gameTranscript(): { seed: number; moves: string; size: number } {
    return this.board.gameTranscript();
  }

  constructor() {
    this.missions.ensureFresh();
    // Geri sayım bitince oyun-sonu kararını çekirdek verir (döngüsüz geri çağrı).
    this.timer.onExpire = () => this.engine.onCountdownExpire();
  }

  // --- Fabrika / kurulum fonksiyonları ------------------------

  /** NxN boş ızgara üretir (BoardStore'dan). */
  createEmptyGrid(): Grid {
    return this.board.createEmptyGrid();
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
    this.cancelAutoplay(); // sürüyorsa gösterimi bitir, eski durumu ATMA
    this.paused.set(false);
    this.aiAssisted.set(false); // yeni oyun → temiz sayfa
    this.assistant.resetHints();
    this.assistant.resetMoveReview();
    this.mode.set(mode);
    this.boardSize.set(size);
    this.tiles.set([]);
    this.score.set(0);
    this.moves.set(0);
    this.board.keepPlaying.set(false);
    this.history.set(null);
    this.clearPowerFx();
    this.status.set(GameStatus.Playing);
    this.spawnRandomTile();
    this.spawnRandomTile();

    if (mode === GameMode.TimeAttack) {
      this.startCountdown(TIME_ATTACK_SECONDS);
    } else if (mode === GameMode.Zen) {
      this.stopTimer(); // süresiz
      this.elapsedSeconds.set(0);
    } else {
      this.startTimer(0); // Classic: yukarı sayar
    }
    this.registerActivity();
  }

  /**
   * Çok oyunculu yarışı başlatır: ortak `seed` ile tohumlu RNG → tüm
   * oyuncular birebir aynı taş dizisini alır (adil yarış). `duration`
   * saniyelik geri sayım; süre bitince skor kalır (Zaman Yarışı gibi).
   */
  /**
   * Günlük meydan okumayı başlatır: tohum günden türetilir, herkes AYNI
   * tahtayı oynar. Yarıştan farkı tek kişilik olması ve sonucun günlük
   * sıralamaya gönderilmesidir.
   */
  startDaily(): void {
    const day = utcDayKey();
    this.cancelAutoplay();
    this.paused.set(false);
    this.aiAssisted.set(false);
    this.assistant.resetHints();
    this.assistant.resetMoveReview();
    this.beginRecordedGame(dailySeed(day)); // tohum günden türetilir
    this.dailyDay.set(day);
    this.mode.set(GameMode.Daily);
    this.boardSize.set(BOARD_SIZE); // günlük her zaman 4×4 (adil)
    this.tiles.set([]);
    this.score.set(0);
    this.moves.set(0);
    this.board.keepPlaying.set(true); // 2048'de durma, süre bitene dek oyna
    this.history.set(null);
    this.clearPowerFx();
    this.status.set(GameStatus.Playing);
    this.spawnRandomTile();
    this.spawnRandomTile();
    this.startCountdown(DAILY_DURATION);
    this.registerActivity();
  }

  /** Oynanan günlük meydan okumanın gün anahtarı (sonuç gönderimi için). */
  readonly dailyDay = signal<string>('');

  startRace(seed: number, duration: number): void {
    this.cancelAutoplay();
    this.paused.set(false);
    this.aiAssisted.set(false); // yeni yarış → temiz sayfa
    this.assistant.resetHints();
    this.assistant.resetMoveReview();
    this.beginRecordedGame(seed); // yarış: ortak tohum (herkes aynı taşlar)
    this.mode.set(GameMode.Race);
    this.boardSize.set(BOARD_SIZE); // yarış her zaman 4×4
    this.tiles.set([]);
    this.score.set(0);
    this.moves.set(0);
    this.board.keepPlaying.set(true); // 2048'de durma; süre bitene dek yarış
    this.history.set(null);
    this.clearPowerFx();
    this.status.set(GameStatus.Playing);
    this.spawnRandomTile();
    this.spawnRandomTile();
    this.startCountdown(duration);
    this.registerActivity();
  }

  // --- YZ Asistanı (AssistantStore'a delege) -----------------

  static readonly ASSIST_HINT_QUOTA = ASSIST_HINT_QUOTA;

  readonly assistantOn = this.assistant.assistantOn;
  readonly lastMoveReview = this.assistant.lastMoveReview;
  readonly moveRatings = this.assistant.moveRatings;
  readonly ratedMoves = this.assistant.ratedMoves;
  readonly accuracy = this.assistant.accuracy;
  readonly health = this.assistant.health;
  readonly assistHintsLeft = this.assistant.assistHintsLeft;
  readonly assistHintDir = this.assistant.assistHintDir;
  readonly autoplaying = this.assistant.autoplaying;
  readonly aiAssisted = this.assistant.aiAssisted;
  readonly aiDemoResult = this.assistant.aiDemoResult;

  setAssistant(on: boolean): void {
    this.assistant.setAssistant(on);
  }

  /** Öneri iste (hak varsa) — AssistantStore. */
  requestAssistHint(): void {
    this.assistant.requestHint();
  }

  /** İlerleme (rekor, görev, istatistik, altın) sayılmamalı mı? */
  aiPlayed(): boolean {
    return this.assistant.aiPlayed();
  }

  // --- Kutlama (ses + konfeti tetikleyici) --------------------

  /** Kutlama olayı (GameEngine tetikler; arayüz konfeti + ses için izler). */
  readonly celebration = this.engine.celebration;

  private autoplayTimer: ReturnType<typeof setTimeout> | null = null;
  private autoplayLevel: AiLevel = 'expert';

  /** Mevcut taşları YZ için değer ızgarasına (number[][]) çevirir. */
  toValueGrid(): ValueGrid {
    return this.board.toValueGrid();
  }

  /**
   * YZ gösterimi başlamadan ÖNCEKİ oyun durumu.
   * YZ yalnızca bir örnektir: durdurulunca oyuncu kendi tahtasına,
   * kendi skoruna ve kendi süresine geri döner.
   */
  private preAiSnapshot: AiDemoSnapshot | null = null;
  private demoNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  /** YZ otomatik oynatmayı başlat/durdur. */
  toggleAutoplay(level: AiLevel = 'expert'): void {
    if (this.autoplaying()) this.stopAutoplay();
    else this.startAutoplay(level);
  }

  /** YZ gösterimini başlatır (mevcut tahtadan devam ederek oynar). */
  startAutoplay(level: AiLevel = 'expert'): void {
    if (this.autoplaying()) return;
    if (this.status() !== GameStatus.Playing) return;

    // Oyuncunun durumunu sakla — gösterim bitince aynen geri yüklenecek.
    this.preAiSnapshot = {
      tiles: this.tiles().map((t) => ({ ...t })),
      score: this.score(),
      moves: this.moves(),
      status: this.status(),
      keepPlayingAfterWin: this.board.keepPlaying(),
      history: this.history(),
      elapsedSeconds: this.elapsedSeconds(),
      remainingSeconds: this.remainingSeconds(),
      countdownTotal: this.timer.countdownTotal,
      assistHintsLeft: this.assistHintsLeft(),
    };

    // Sayacı DONDUR: gösterim oyuncunun saatiyle oynanmaz. Aksi hâlde
    // süre gösterim sırasında bitip oyun-sonu ekranını bir an gösterebilir
    // (o an bir butona basmak istenmeyen işlem tetikler). Süre restorePreAi'de
    // anlık görüntüden geri yüklenir.
    this.stopTimer();

    this.aiDemoResult.set(null);
    this.autoplayLevel = level;
    this.autoplaying.set(true);
    this.autoplayStep();
  }

  /** Gösterimi durdurur ve oyuncunun kendi oyununu geri yükler. */
  stopAutoplay(): void {
    const wasPlaying = this.autoplaying();
    this.haltAutoplayTimer();
    if (wasPlaying) this.restorePreAi();
  }

  /**
   * Gösterimi iptal eder ve kaydı ATAR (geri yükleme yok).
   * Yeni oyun başlarken kullanılır: eski oyunun durumu geri gelmemeli.
   */
  private cancelAutoplay(): void {
    this.haltAutoplayTimer();
    this.preAiSnapshot = null;
    this.aiDemoResult.set(null);
  }

  private haltAutoplayTimer(): void {
    this.autoplaying.set(false);
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

    const aiScore = this.score(); // gösterimde YZ'nin ulaştığı skor

    // Animasyon bayraklarını temizleyerek geri yükle (geri-al ile aynı):
    // yoksa gösterim öncesi taşlar tekrar pop/bump oynatırdı.
    this.tiles.set(snap.tiles.map((t) => ({ id: t.id, value: t.value, row: t.row, col: t.col })));
    this.score.set(snap.score);
    this.moves.set(snap.moves);
    this.board.keepPlaying.set(snap.keepPlayingAfterWin);
    this.history.set(snap.history);
    this.status.set(snap.status);
    this.assistHintsLeft.set(snap.assistHintsLeft);
    this.assistHintDir.set(null);
    this.clearPowerFx();

    // Süre de geri gelir: gösterim oyuncunun süresini yemez.
    this.timer.restore(snap.elapsedSeconds, snap.remainingSeconds, snap.countdownTotal);
    if (snap.status === GameStatus.Playing && !this.paused()) {
      this.resumeTimerForMode();
    }

    // YZ'nin oynadığı her şey atıldı → oyuncu bir avantaj devralmıyor,
    // dolayısıyla bu oyun artık "YZ destekli" sayılmaz.
    this.aiAssisted.set(false);

    this.aiDemoResult.set(aiScore);
    if (typeof setTimeout !== 'undefined') {
      if (this.demoNoticeTimer) clearTimeout(this.demoNoticeTimer);
      this.demoNoticeTimer = setTimeout(() => this.aiDemoResult.set(null), 5000);
    }
  }

  /** İki YZ hamlesi arası bekleme (ms) — izlenebilir olsun diye. */
  private autoplaySpeed = 400;

  /** Otomatik oynatma hızını ayarla (ms/hamle). */
  setAutoplaySpeed(ms: number): void {
    this.autoplaySpeed = Math.max(120, Math.min(1200, ms));
  }

  /** Tek YZ hamlesi + bir sonrakini zamanla. */
  private autoplayStep(): void {
    if (!this.autoplaying()) return;
    if (this.status() !== GameStatus.Playing) {
      this.stopAutoplay();
      return;
    }
    if (typeof setTimeout === 'undefined') return;
    // Duraklatıldıysa hamle yapma, sadece beklemeye devam et.
    if (this.paused()) {
      this.autoplayTimer = setTimeout(() => this.autoplayStep(), 200);
      return;
    }
    const dir = bestMove(this.toValueGrid(), this.autoplayLevel);
    if (!dir) {
      this.stopAutoplay();
      return;
    }
    // Gösterim boyunca hiçbir ilerleme sayılmaz (geri yükleme başarısız
    // olsa bile oyuncu YZ'nin tahtasından avantaj devralmasın).
    this.aiAssisted.set(true);
    this.move(dir);

    // YZ oyunu bitirdiyse hemen dur: oyun sonu ekranı bir an bile
    // görünmeden oyuncunun kendi tahtası geri gelir.
    if (this.status() !== GameStatus.Playing) {
      this.stopAutoplay();
      return;
    }
    this.autoplayTimer = setTimeout(() => this.autoplayStep(), this.autoplaySpeed);
  }

  // --- Seviye modu --------------------------------------------

  /** Seviye modunu 1. seviyeden başlatır. */
  startLevelMode(): void {
    this.mode.set(GameMode.Level);
    this.level.set(1);
    this.startLevel();
    this.registerActivity(); // gün serisi
  }

  /** Anlık seviyeyi (yeniden) başlatır: boş tahta + geri sayım. */
  private startLevel(): void {
    this.beginRecordedGame(this.board.randomSeed());
    this.cancelAutoplay(); // sürüyorsa gösterimi bitir, eski durumu ATMA
    this.paused.set(false);
    this.aiAssisted.set(false); // yeni seviye → temiz sayfa
    this.assistant.resetHints();
    this.assistant.resetMoveReview();
    const cfg = levelConfig(this.level());
    this.boardSize.set(BOARD_SIZE); // seviye modu her zaman 4×4
    this.tiles.set([]);
    this.score.set(0);
    this.moves.set(0);
    this.lastReward.set(0);
    this.board.keepPlaying.set(false);
    this.history.set(null);
    this.clearPowerFx();
    this.status.set(GameStatus.Playing);
    this.spawnRandomTile();
    this.spawnRandomTile();
    this.startCountdown(cfg.seconds);

    // Bu seviyeye ulaşıldı → en yüksek seviyeyi güncelle (ProfileService)
    this.profile.reportBestLevel(this.level());
  }

  /**
   * Ana (başlık) ekrana döner: oyunu durdurur, durumu Idle'a alır.
   * Böylece mod/tahta seçim ekranı yeniden görünür.
   */
  goHome(): void {
    this.cancelAutoplay(); // ana ekrana dönerken geri yüklenecek bir şey yok
    this.stopTimer();
    this.paused.set(false);
    this.board.clearRng();
    this.status.set(GameStatus.Idle);
  }

  /** Mevcut modu ve boyutu yeniden başlatır (Yeni Oyun / Baştan). */
  restartCurrent(): void {
    // Yarış sırasında "Yeni Oyun" YOK: tohumlu yarışı tohumsuz/süresiz bir
    // tek kişilik oyuna çevirip skoru sunucuya bildirmeye devam ederdi.
    if (this.mode() === GameMode.Race) return;
    // Günlük: aynı günün tahtasıyla tekrar dene (en iyi skorun sayılır).
    if (this.mode() === GameMode.Daily) {
      this.startDaily();
      return;
    }
    if (this.mode() === GameMode.Level) {
      this.startLevelMode();
    } else {
      this.startMode(this.mode(), this.boardSize());
    }
  }

  /** Seviye başarısız olunca aynı seviyeyi tekrar dener. */
  retryLevel(): void {
    if (this.mode() !== GameMode.Level) return;
    this.startLevel();
  }

  /** Seviye tamamlanınca bir sonraki seviyeye geçer. */
  nextLevel(): void {
    if (this.status() !== GameStatus.LevelComplete) return;
    if (this.level() >= MAX_LEVEL) return; // zaten son seviye
    this.level.update((l) => l + 1);
    this.startLevel();
  }

  /** Oyunu başlık ekranına döndürür. */
  reset(): void {
    this.tiles.set([]);
    this.score.set(0);
    this.moves.set(0);
    this.board.keepPlaying.set(false);
    this.history.set(null);
    this.status.set(GameStatus.Idle);
    this.mode.set(GameMode.Classic);
    this.boardSize.set(BOARD_SIZE);
    this.level.set(1);
    this.clearPowerFx();
    this.stopTimer();
    this.elapsedSeconds.set(0);
    this.remainingSeconds.set(0);
  }

  /**
   * Son hamleyi geri alır (tek adım).
   * Oyun bittiyse (Won/Lost) de çalışır — kaybettiren hamle geri alınabilir.
   * En yüksek skor GERİ ALINMAZ (o bir rekor kaydı).
   * @returns geri alma yapıldıysa true.
   */
  undo(): boolean {
    // Tohumlu modlarda (yarış + günlük) geri alma YOK: taş dizisi geri
    // sarılamaz, geri alınca oyuncunun akışı diğerlerinden sapar
    // (haksız yeniden çekiliş).
    if (this.mode() === GameMode.Race || this.mode() === GameMode.Daily) {
      return false;
    }

    const snapshot = this.history();
    if (!snapshot) return false;

    // Animasyon bayraklarını temizleyerek geri yükle (pop/bump tekrar oynamasın)
    this.tiles.set(
      snapshot.tiles.map((t) => ({
        id: t.id,
        value: t.value,
        row: t.row,
        col: t.col,
      })),
    );
    this.score.set(snapshot.score);
    this.moves.set(snapshot.moves);
    this.board.keepPlaying.set(snapshot.keepPlayingAfterWin);
    this.status.set(snapshot.status);

    // Tek adımlık geçmiş: geri aldıktan sonra tekrar geri alınamaz
    this.history.set(null);

    // Biten oyun (Kayıp/Başarısız/Kazanç) geri alma ile yeniden oynanır
    // hâle geldiyse sayaç da yeniden başlamalı. Aksi hâlde süre donmuş
    // kalır ve oyuncu sınırsız süreyle oynardı.
    if (snapshot.status === GameStatus.Playing) this.resumeTimerForMode();
    return true;
  }

  /** Mevcut moda uygun sayacı kaldığı yerden sürdürür (TimerService). */
  private resumeTimerForMode(): void {
    this.timer.resumeForMode();
  }

  /** Kazandıktan sonra "Devam Et": oyuna geri dön, kazanmayı bir daha tetikleme. */
  continueAfterWin(): void {
    if (this.status() !== GameStatus.Won) return;
    this.board.keepPlaying.set(true);
    this.status.set(GameStatus.Playing);
    // Süre kaldığı yerden devam etsin (donmuş değerden ileri)
    this.startTimer(this.elapsedSeconds());
  }

  // --- Altın ekonomisi ----------------------------------------

  /** Altın ekler (kazanç → toplam kazanç + görev) — GameEngine. */
  addGold(amount: number): void {
    this.engine.addGold(amount);
  }

  /** Altın harcar. Yeterli değilse harcamaz. @returns başarılıysa true. */
  spendGold(amount: number): boolean {
    return this.engine.spendGold(amount);
  }

  // --- Güçler (mağaza + kullanım) -----------------------------

  /**
   * Bir gücü altınla satın alır (envantere ekler).
   * @returns satın alma başarılıysa true (yeterli altın vs.).
   */
  buyPower(id: PowerId): boolean {
    return this.powersSvc.buy(id);
  }

  /**
   * Bir gücü kullanır (envanterden düşer, etkisini uygular).
   * @returns güç kullanıldıysa true.
   */
  usePower(id: PowerId): boolean {
    if (this.powers()[id] <= 0) return false;
    if (this.status() !== GameStatus.Playing) return false;

    let applied = false;
    switch (id) {
      case 'time':
        applied = this.applyAddTime();
        break;
      case 'bomb':
        // Bomba: hedefleme modunu aç. Güç, kare gerçekten silinince düşer.
        this.bombMode.set(true);
        return true; // henüz tüketilmedi
      case 'shuffle':
        applied = this.applyShuffle();
        break;
      case 'undo':
        applied = this.undo();
        break;
      case 'hint':
        applied = this.applyHint();
        break;
    }

    if (applied) this.consumePower(id);
    return applied;
  }

  /** Bomba hedefleme modundayken bir kareyi siler (gücü tüketir). */
  removeTileAt(row: number, col: number): boolean {
    if (!this.bombMode()) return false;
    const exists = this.tiles().some((t) => t.row === row && t.col === col);
    if (!exists) return false;

    this.tiles.update((list) => list.filter((t) => !(t.row === row && t.col === col)));
    this.consumePower('bomb');
    this.bombMode.set(false);
    // Geri alma bombalanan kareyi geri getirip gücü boşa harcatırdı.
    this.history.set(null);

    if (this.profile.markBombUsed()) {
      this.checkAchievements(); // "Bombacı" başarımı
    }
    return true;
  }

  /** Bomba modunu iptal eder (güç harcanmaz). */
  cancelBomb(): void {
    this.bombMode.set(false);
  }

  private consumePower(id: PowerId): void {
    this.powersSvc.decrement(id);
    this.trackMission('powers', 1); // görev: güç kullan
    // Güç kullanılan oyun şampiyonluk sıralamasına GİRMEZ (doğrulanamaz +
    // eşit şartlar). Yalnızca sıralama dışı bırakır; oyun normal devam eder.
    this.powerUsedThisGame.set(true);
  }

  /** +30 saniye: yalnızca seviye modunda ve oynanırken. */
  private applyAddTime(): boolean {
    if (this.mode() !== GameMode.Level) return false;
    this.timer.addTime(TIME_POWER_SECONDS);
    return true;
  }

  /** Karıştır: mevcut karelerin değerlerini rastgele boş hücrelere dağıtır. */
  private applyShuffle(): boolean {
    const current = this.tiles();
    if (current.length === 0) return false;

    const n = this.boardSize();
    const cells: Cell[] = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) cells.push({ row: r, col: c });
    }

    // Karıştırma oyuncunun PARAYLA aldığı bir güç: kendisini oynanamaz bir
    // tahtaya kilitlememeli. Hamlesi kalan bir dizilim bulunana dek dene.
    let shuffled: Tile[] = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cells[i], cells[j]] = [cells[j], cells[i]];
      }
      // id'ler korunur → kareler yeni yerlerine kayarak animasyonla gider.
      shuffled = current.map((t, i) => ({
        id: t.id,
        value: t.value,
        row: cells[i].row,
        col: cells[i].col,
      }));
      if (hasAnyMove(shuffled, n)) break;
    }

    this.tiles.set(shuffled);

    // Tahta yine de kilitliyse (ör. dolu tahtada eş kare yok) oyunu
    // usulünce bitir; sessizce donmuş bir ekranda bırakma.
    if (!hasAnyMove(shuffled, n)) {
      this.stopTimer();
      if (this.mode() === GameMode.Level) {
        this.status.set(GameStatus.Failed);
      } else {
        this.status.set(GameStatus.Lost);
      }
      this.recordGameEnd(false);
    }
    return true;
  }

  /** İpucu: 1 hamle ileriye bakan basit sezgiyle en iyi yönü işaretler. */
  private applyHint(): boolean {
    const dir = this.computeHint();
    if (!dir) return false;

    this.hintDirection.set(dir);
    if (this.hintTimer) clearTimeout(this.hintTimer);
    if (typeof setTimeout !== 'undefined') {
      this.hintTimer = setTimeout(() => this.hintDirection.set(null), 2500);
    }
    return true;
  }

  /**
   * En iyi hamleyi YAPAY ZEKÂ (expectimax) ile seçer — "sonraki hamle önerisi".
   * Aynı motoru otomatik oynatma ve çok oyunculu bot da kullanır.
   */
  private computeHint(): Direction | null {
    return bestMove(this.toValueGrid(), 'expert');
  }

  /** Yeni oyun/seviye/reset'te güç efektlerini temizle. */
  private clearPowerFx(): void {
    this.bombMode.set(false);
    this.hintDirection.set(null);
    if (this.hintTimer) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
  }

  // --- Profil (ProfileService'e delege) -----------------------

  /** Seçili profil avatarı (ProfileService'te). */
  readonly avatar = this.profile.avatar;

  /** Oyuncu adını ayarlar (ProfileService). */
  setName(name: string): void {
    this.profile.setName(name);
  }

  /** Avatarı değiştirir (ProfileService; listede olmayan değer yok sayılır). */
  setAvatar(a: string): void {
    this.profile.setAvatar(a);
  }

  // --- Hesap senkronizasyonu ----------------------------------

  /**
   * Hesaba kaydedilecek ilerleme anlık görüntüsü. Sürüm + zaman damgaları,
   * sunucunun ALAN BAZLI birleştirmesi içindir (bkz. server merge_progress):
   * rekorlar/sayaçlar MAX, başarımlar birleşim, altın kazanılan/harcanan MAX,
   * ad/avatar prefsAt'a göre en son değişen kazanır.
   */
  accountSnapshot(): Record<string, unknown> {
    return {
      v: 2,
      updatedAt: Date.now(),
      prefsAt: this.profile.prefsUpdatedAt(),
      gold: this.gold(),
      totalGoldEarned: this.totalGoldEarned(),
      bestScore: this.bestScore(),
      bestLevel: this.bestLevel(),
      name: this.playerName(),
      avatar: this.avatar(),
      championships: this.championships(),
      gamesPlayed: this.gamesPlayed(),
      gamesWon: this.gamesWon(),
      bestTile: this.bestTile(),
      totalMoves: this.totalMoves(),
      achievements: [...this.unlockedAchievements()],
    };
  }

  /** Hesaptan gelen ilerlemeyi uygular ve kalıcı kaydeder. */
  applyAccountSnapshot(d: Record<string, unknown>): void {
    const num = (v: unknown) => (typeof v === 'number' && v >= 0 ? v : null);
    const g = num(d['gold']);
    if (g !== null) this.gold.set(g);
    const tge = num(d['totalGoldEarned']);
    if (tge !== null) this.totalGoldEarned.set(tge);
    const bs = num(d['bestScore']);
    if (bs !== null) this.bestScore.set(bs);
    const bl = num(d['bestLevel']);
    if (bl !== null) this.bestLevel.set(bl);
    if (typeof d['name'] === 'string') this.playerName.set(d['name'] as string);
    if (typeof d['avatar'] === 'string' && AVATARS.includes(d['avatar'] as string)) {
      this.avatar.set(d['avatar'] as string);
    }
    const champ = num(d['championships']);
    if (champ !== null) this.championships.set(champ);
    const gp = num(d['gamesPlayed']);
    if (gp !== null) this.gamesPlayed.set(gp);
    const gw = num(d['gamesWon']);
    if (gw !== null) this.gamesWon.set(gw);
    const bt = num(d['bestTile']);
    if (bt !== null) this.bestTile.set(bt);
    const tm = num(d['totalMoves']);
    if (tm !== null) this.totalMoves.set(tm);
    if (Array.isArray(d['achievements'])) {
      this.achievements.restore(
        (d['achievements'] as unknown[]).filter((x) => typeof x === 'string') as string[],
      );
    }
    // Tercih zaman damgası (birleşmiş değer sunucudan) — LWW tutarlılığı için.
    const pa = num(d['prefsAt']);
    if (pa !== null) this.profile.prefsUpdatedAt.set(pa);
    // Kalıcı kaydet (ekonomi + profil kendi durumunu yazar; başarımları restore kaydetti)
    this.economy.save();
    this.profile.persist();
  }

  /**
   * Oyun başlangıcında günün aktivitesini kaydeder (RewardsService seriyi
   * ilerletir); ardından seri-başarımlarını kontrol eder (orkestrasyon).
   */
  private registerActivity(): void {
    this.engine.registerActivity();
  }

  /** Günlük ödülü alır (günde bir kez) — GameEngine. */
  claimDailyReward(): boolean {
    return this.engine.claimDailyReward();
  }

  /** Bugün alınan ödülün ayrıntısı (RewardsService'te). */
  readonly claimedReward = this.rewards.claimedReward;

  /**
   * Ay sonu şampiyonluk ödülünü envantere ekler.
   * Sunucu ödülün alındığını kendi tarafında işaretler; burada yalnızca
   * altın ve güçler eklenir (ardından bulut senkronu devreye girer).
   */
  grantChampionPrize(gold: number, powers: Record<string, number>): void {
    this.engine.grantChampionPrize(gold, powers);
  }

  /** Kazanılan ay sonu şampiyonluğu sayısı (ProfileService'te). */
  readonly championships = this.profile.championships;

  /**
   * Bugün alınacak/alınan ödülün döngüdeki günü (1-7).
   * Ödül henüz alınmadıysa, alınınca serinin NE OLACAĞI hesaplanır —
   * böylece takvim doğru günü vurgular (seri kırıldıysa 1'e döner).
   */
  readonly rewardCycleDay = this.rewards.rewardCycleDay;

  /** 7 günlük ödül takvimi (RewardsService'te). */
  readonly rewardCalendar = this.rewards.rewardCalendar;

  /** Oyun sonu istatistik güncellemesi (GameEngine; güç efektleri kullanır). */
  private recordGameEnd(won: boolean): void {
    this.engine.recordGameEnd(won);
  }

  /** Bir başarımın ilerlemesi: `{ current, target }` — GameEngine. */
  achievementProgress(id: string): { current: number; target: number } {
    return this.engine.achievementProgress(id);
  }

  /** Oyuncu ünvanı (GameEngine'de). */
  readonly rankInfo = this.engine.rankInfo;

  /** Yeni başarımları açar + ödül/kutlama (GameEngine; güç efektleri kullanır). */
  private checkAchievements(): void {
    this.engine.checkAchievements();
  }

  /** Bir metrik için görev ilerlemesini bildirir (GameEngine; güç efektleri kullanır). */
  private trackMission(metric: MissionMetric, amount: number): void {
    this.engine.trackMission(metric, amount);
  }

  /** Tamamlanmış bir görevin ödülünü alır — GameEngine. */
  claimMission(id: string, type: 'daily' | 'weekly'): boolean {
    return this.engine.claimMission(id, type);
  }

  /** Verilen yöne hamle yapar — GameEngine. */
  move(direction: Direction): boolean {
    return this.engine.move(direction);
  }

  // --- Süre sayacı (TimerService'e delege) --------------------

  private startTimer(fromSeconds: number): void {
    this.timer.startUp(fromSeconds);
  }

  private startCountdown(seconds: number, fromElapsed = 0): void {
    this.timer.startCountdown(seconds, fromElapsed);
  }

  private stopTimer(): void {
    this.timer.stopTimer();
  }

  // --- Duraklat / Devam (TimerService'e delege) ---------------

  /** Oyun duraklatıldı mı? (TimerService'te) */
  readonly paused = this.timer.paused;

  togglePause(): void {
    this.timer.togglePause();
  }

  pauseGame(): void {
    this.timer.pauseGame();
  }

  resumeGame(): void {
    this.timer.resumeGame();
  }

  // --- Yardımcılar (BoardStore'a delege) ----------------------

  /** Boş hücrelerin konum listesini döndürür. */
  emptyCells(): Cell[] {
    return this.board.emptyCells();
  }

  /** Rastgele boş bir hücreye yeni bir taş ekler. Boş hücre yoksa null döner. */
  spawnRandomTile(): Tile | null {
    return this.board.spawnRandomTile();
  }
}
