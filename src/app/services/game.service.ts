import { Injectable, computed, inject, signal } from '@angular/core';
import { EconomyService } from './economy.service';
import { MissionsService } from './missions.service';
import { ProfileService } from './profile.service';
import { AchievementsService, AchievementStats } from './achievements.service';
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
import { MOVE_CHAR, applyMove, hasAnyMove } from '../logic/board-logic';
import {
  AiLevel,
  MoveReview,
  ValueGrid,
  bestMove,
  emptyGrid,
  mulberry32,
  positionHealth,
  reviewMove,
} from '../logic/ai';
import { rankFor, rankPoints } from '../logic/rank';
import { DAILY_DURATION, dailySeed, utcDayKey } from '../logic/daily-challenge';

/** Kutlama türü — arayüz hangi sesi/mesajı göstereceğini seçer. */
export type CelebrationKind = 'win' | 'level' | 'achievement';
import { MAX_LEVEL, levelConfig } from '../models/level.model';
import { PowerId, PowerInventory, emptyInventory, powerDef } from '../models/power.model';
import { dayKey, streakAfterActivity, yesterdayKey } from '../logic/daily';
import { DAILY_REWARDS, DailyReward, cycleDay, rewardForStreak } from '../logic/daily-rewards';
import { MissionMetric, MissionProgress } from '../models/mission.model';
import {
  AVATARS,
  loadAssistant,
  loadDailyDay,
  loadPowers,
  loadRewardedLevels,
  loadStreak,
  loadStreakDay,
  saveAssistant,
  saveDailyDay,
  savePowers,
  saveRewardedLevels,
  saveStreak,
} from './game-storage';

/** Avatar listesi kalıcılık katmanında; eski içe aktarımlar için yeniden dışa aç. */
export { AVATARS } from './game-storage';

// ============================================================
//  2048 — Oyun servisi
//  Oyunun tüm durumu Angular signal'ları ile tutulur.
//  Kaynak gerçeği (source of truth): `tiles` — tahtadaki taşların
//  listesi. `grid` bu listeden türetilen 2B görünümdür.
// ============================================================

/** Yeni taşın 4 gelme olasılığı (kalan %90 → 2). */
const CHANCE_OF_FOUR = 0.1;

/** Kazanma değeri. */
const WIN_VALUE = 2048;

/** +30 saniye gücünün eklediği süre. */
const TIME_POWER_SECONDS = 30;

/** Geri al için saklanan tek adımlık oyun durumu. */
interface GameSnapshot {
  tiles: Tile[];
  score: number;
  moves: number;
  status: GameStatus;
  keepPlayingAfterWin: boolean;
}

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

  /** Taşlara benzersiz id vermek için artan sayaç. */
  private nextId = 1;

  /** 2048'e ulaşıp "Devam Et" denildi mi? (kazanma tekrar tetiklenmesin) */
  private keepPlayingAfterWin = false;

  /** Süre sayacının setInterval kimliği (çalışmıyorsa null). */
  private timerId: ReturnType<typeof setInterval> | null = null;

  /** Süre sayacının başladığı an (epoch ms). */
  private startTimestamp = 0;

  // --- Durum sinyalleri ---------------------------------------

  /** Tahtadaki taşların listesi (kaynak gerçeği). */
  readonly tiles = signal<Tile[]>([]);

  /** Anlık skor. */
  readonly score = signal<number>(0);

  /** Bu oyunda yapılan geçerli hamle sayısı. */
  readonly moves = signal<number>(0);

  /** Bu oyunda geçen süre (saniye). */
  readonly elapsedSeconds = signal<number>(0);

  /** (Seviye modu) kalan süre (saniye). */
  readonly remainingSeconds = signal<number>(0);

  /** En yüksek skor (localStorage'dan yüklenir, değişince kaydedilir). */
  readonly bestScore = this.profile.bestScore;

  /** Oyunun anlık durumu. */
  readonly status = signal<GameStatus>(GameStatus.Idle);

  /** Oyun modu (klasik / seviye / zen / zaman yarışı). */
  readonly mode = signal<GameMode>(GameMode.Classic);

  /** Anlık tahta boyutu (NxN). Seviye modu her zaman 4. */
  readonly boardSize = signal<number>(BOARD_SIZE);

  /** (Seviye modu) anlık seviye. */
  readonly level = signal<number>(1);

  /** Ulaşılan en yüksek seviye (ProfileService'te). */
  readonly bestLevel = this.profile.bestLevel;

  /** Toplam altın (EconomyService'te; API sabit kalsın diye delege edilir). */
  readonly gold = this.economy.gold;

  /** Bugüne kadar kazanılan toplam altın (EconomyService'te). */
  readonly totalGoldEarned = this.economy.totalGoldEarned;

  /** Ödülü zaten alınmış seviyeler (tekrar tamamlamada altın verilmez). */
  private readonly rewardedLevels = new Set<number>(loadRewardedLevels());

  /** Son seviye tamamlamada kazanılan altın (0 → zaten alınmıştı). */
  readonly lastReward = signal<number>(0);

  /** Güç envanteri (her güçten kaç adet). */
  readonly powers = signal<PowerInventory>(loadPowers());

  /** Bomba hedefleme modu açık mı? (bir kareye dokununca silinir) */
  readonly bombMode = signal<boolean>(false);

  /** İpucu yönü (kısa süre gösterilir, sonra temizlenir). */
  readonly hintDirection = signal<Direction | null>(null);

  /** (Seviye modu) geri sayımın toplam süresi (saniye) — +30 gücü bunu artırır. */
  private countdownTotal = 0;

  /** Geri sayım yeniden başlatılırken korunan "geçen süre" birikimi (saniye). */
  private elapsedOffset = 0;

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

  /** Anlık gün serisi. */
  readonly currentStreak = signal<number>(loadStreak('current'));
  /** En yüksek seri. */
  readonly bestStreak = signal<number>(loadStreak('best'));
  private lastActiveDay = signal<string | null>(loadStreakDay());

  /** Günlük ödülün son alındığı gün. */
  private lastRewardDay = signal<string | null>(loadDailyDay());
  /** Son günlük ödül miktarı (UI gösterimi için). */
  readonly lastDailyReward = signal<number>(0);

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

  /** Bugün günlük ödül alınabilir mi? */
  readonly canClaimDaily = computed<boolean>(() => this.lastRewardDay() !== dayKey(new Date()));

  /** (Seviye modu) anlık seviyenin hedef karesi. */
  readonly levelTarget = computed<number>(() => levelConfig(this.level()).target);

  /** Son hamleden ÖNCEKİ durum (tek adımlık geçmiş). */
  private readonly history = signal<GameSnapshot | null>(null);

  /**
   * Geri alınabilecek bir hamle var mı?
   * Tohumlu modlarda (yarış + günlük) geri alma yasak olduğundan buton da
   * pasif olmalı; yoksa aktif görünüp tıklayınca hiçbir şey yapmıyordu.
   */
  readonly canUndo = computed<boolean>(
    () =>
      this.history() !== null && this.mode() !== GameMode.Race && this.mode() !== GameMode.Daily,
  );

  // --- Türetilmiş sinyaller -----------------------------------

  /** `tiles` listesinden üretilen NxN ızgara (okumak/çizmek için). */
  readonly grid = computed<Grid>(() => {
    const g = this.createEmptyGrid();
    for (const tile of this.tiles()) {
      g[tile.row][tile.col] = tile;
    }
    return g;
  });

  /**
   * ŞU ANKİ tahtadaki en yüksek kare. `bestTile` tüm zamanların
   * istatistiğidir; yarış tablosunda o gösterilirse oyuncunun geçmiş
   * rekoru o yarışta yapmış gibi görünür.
   */
  readonly currentBestTile = computed<number>(() =>
    this.tiles().reduce((max, t) => (t.value > max ? t.value : max), 0),
  );

  /** Boştaki hücre sayısı (hamle üretmek/oyun sonu için). */
  readonly emptyCount = computed<number>(
    () => this.boardSize() * this.boardSize() - this.tiles().length,
  );

  /**
   * Aktif oyunun tohumlu RNG'si. ARTIK HER OYUN TOHUMLUDUR — böylece
   * sunucu, tohum + hamle dizisinden oyunu birebir yeniden oynatıp skoru
   * kendisi hesaplayabilir (skor tablosu hile yapılamaz olur).
   * null yalnızca oyun yokken (başlık ekranı) olur.
   */
  private gameRng: (() => number) | null = null;

  /** Aktif oyunun tohumu (doğrulama transkriptinde gönderilir). */
  readonly gameSeed = signal<number>(0);

  /** Bu oyunda uygulanan hamlelerin dizisi ("U/D/L/R"). */
  private recordedMoves = '';

  /**
   * Bu oyunda GÜÇ kullanıldı mı? Kullanıldıysa oyun şampiyonluk
   * sıralamasına GİRMEZ (bomba/karıştır/geri al hamle dizisinden
   * türetilemez; ayrıca herkesin eşit şartlarda yarışması için).
   */
  readonly powerUsedThisGame = signal<boolean>(false);

  /** Aktif rastgelelik kaynağı (her oyun tohumlu; oyun yoksa Math.random). */
  private rand(): number {
    return this.gameRng ? this.gameRng() : Math.random();
  }

  /**
   * Yeni bir doğrulanabilir oyun kaydı başlatır: tohumu ayarlar, hamle
   * kaydını ve güç bayrağını sıfırlar. Tüm start* fonksiyonları çağırır.
   */
  private beginRecordedGame(seed: number): void {
    const s = seed >>> 0;
    this.gameSeed.set(s);
    this.gameRng = mulberry32(s);
    this.recordedMoves = '';
    this.powerUsedThisGame.set(false);
  }

  /** Rastgele 32-bit tohum (tohumsuz modlar için). */
  private randomSeed(): number {
    return Math.floor(Math.random() * 0x100000000) >>> 0;
  }

  /**
   * Sunucuya gönderilecek doğrulama transkripti.
   * Sunucu bunu yeniden oynatıp skoru KENDİSİ hesaplar.
   */
  gameTranscript(): { seed: number; moves: string; size: number } {
    return {
      seed: this.gameSeed(),
      moves: this.recordedMoves,
      size: this.boardSize(),
    };
  }

  constructor() {
    this.missions.ensureFresh();
  }

  // --- Fabrika / kurulum fonksiyonları ------------------------

  /** NxN boş ızgara üretir (tüm hücreler null). */
  createEmptyGrid(): Grid {
    const n = this.boardSize();
    return Array.from({ length: n }, () => Array.from({ length: n }, () => null));
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
    this.beginRecordedGame(this.randomSeed()); // her oyun tohumlu → doğrulanabilir
    this.cancelAutoplay(); // sürüyorsa gösterimi bitir, eski durumu ATMA
    this.paused.set(false);
    this.aiAssisted.set(false); // yeni oyun → temiz sayfa
    this.resetAssistHints();
    this.resetMoveReview();
    this.mode.set(mode);
    this.boardSize.set(size);
    this.tiles.set([]);
    this.score.set(0);
    this.moves.set(0);
    this.keepPlayingAfterWin = false;
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
    this.resetAssistHints();
    this.resetMoveReview();
    this.beginRecordedGame(dailySeed(day)); // tohum günden türetilir
    this.dailyDay.set(day);
    this.mode.set(GameMode.Daily);
    this.boardSize.set(BOARD_SIZE); // günlük her zaman 4×4 (adil)
    this.tiles.set([]);
    this.score.set(0);
    this.moves.set(0);
    this.keepPlayingAfterWin = true; // 2048'de durma, süre bitene dek oyna
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
    this.resetAssistHints();
    this.resetMoveReview();
    this.beginRecordedGame(seed); // yarış: ortak tohum (herkes aynı taşlar)
    this.mode.set(GameMode.Race);
    this.boardSize.set(BOARD_SIZE); // yarış her zaman 4×4
    this.tiles.set([]);
    this.score.set(0);
    this.moves.set(0);
    this.keepPlayingAfterWin = true; // 2048'de durma; süre bitene dek yarış
    this.history.set(null);
    this.clearPowerFx();
    this.status.set(GameStatus.Playing);
    this.spawnRandomTile();
    this.spawnRandomTile();
    this.startCountdown(duration);
    this.registerActivity();
  }

  // --- YZ Asistanı ------------------------------------------

  /**
   * Asistan açık mı? (Ayarlar'daki anahtar)
   * Öneri, hamle kalitesi ve pozisyon göstergesinin tamamını yönetir.
   */
  readonly assistantOn = signal<boolean>(loadAssistant());

  setAssistant(on: boolean): void {
    this.assistantOn.set(on);
    saveAssistant(on);
    if (!on) this.resetMoveReview();
  }

  // --- Hamle kalitesi + doğruluk ------------------------------

  /** Son hamlenin YZ değerlendirmesi (bir sonraki hamlede yenilenir). */
  readonly lastMoveReview = signal<MoveReview | null>(null);

  /** Bu oyundaki hamle kalitesi sayaçları. */
  readonly moveRatings = signal({ best: 0, good: 0, inaccurate: 0 });

  /** Değerlendirilen toplam hamle. */
  readonly ratedMoves = computed(() => {
    const r = this.moveRatings();
    return r.best + r.good + r.inaccurate;
  });

  /** Doğruluk yüzdesi: en iyi + yakın hamlelerin oranı. */
  readonly accuracy = computed(() => {
    const total = this.ratedMoves();
    if (total === 0) return 100;
    const r = this.moveRatings();
    return Math.round(((r.best + r.good) / total) * 100);
  });

  /** Tahtanın anlık sağlığı (arama yapmaz, ucuzdur). */
  readonly health = computed(() => positionHealth(this.toValueGrid()));

  private resetMoveReview(): void {
    this.lastMoveReview.set(null);
    this.moveRatings.set({ best: 0, good: 0, inaccurate: 0 });
  }

  // --- YZ Asistanı: oyun başına sınırlı hamle önerisi --------

  /** Bir oyunda verilebilecek en fazla öneri sayısı. */
  static readonly ASSIST_HINT_QUOTA = 5;

  /** Bu oyunda kalan öneri hakkı. */
  readonly assistHintsLeft = signal(GameService.ASSIST_HINT_QUOTA);

  /** Şu an gösterilen öneri yönü (hamle yapılınca temizlenir). */
  readonly assistHintDir = signal<Direction | null>(null);

  /** Öneri iste: hak varsa en iyi hamleyi hesaplar ve bir hak düşer. */
  requestAssistHint(): void {
    if (this.status() !== GameStatus.Playing) return;
    if (this.paused() || this.autoplaying()) return;
    if (this.assistHintsLeft() <= 0) return;
    const dir = bestMove(this.toValueGrid(), 'expert');
    if (!dir) return;
    this.assistHintDir.set(dir);
    this.assistHintsLeft.update((n) => n - 1);
  }

  /** Yeni oyunda öneri hakkını yenile. */
  private resetAssistHints(): void {
    this.assistHintsLeft.set(GameService.ASSIST_HINT_QUOTA);
    this.assistHintDir.set(null);
  }

  // --- Yapay zekâ: otomatik oynatma ("YZ'yi izle") -----------

  /** YZ şu an otomatik mi oynuyor? */
  readonly autoplaying = signal(false);

  /**
   * Bu oyunda YZ EN AZ BİR hamle yaptı mı?
   * Yalnızca yeni oyun başlayınca sıfırlanır. `autoplaying` anlık bayrak
   * olduğundan tek başına yetmez: YZ'yi durdurup tek bir manuel hamle yapmak
   * YZ'nin kurduğu tahtayı rekor/görev/altın olarak yazdırabiliyordu.
   */
  readonly aiAssisted = signal(false);

  /** İlerleme (rekor, görev, istatistik, altın) sayılmamalı mı? */
  aiPlayed(): boolean {
    return this.autoplaying() || this.aiAssisted();
  }

  // --- Kutlama (ses + konfeti tetikleyici) --------------------

  /**
   * Kutlama olayı: her yeni başarı anında `id` artar; arayüz bunu izleyip
   * konfeti + ses oynatır. YZ oynadıysa kutlama YOK (gerçek başarı değil).
   */
  readonly celebration = signal<{ id: number; kind: CelebrationKind } | null>(null);
  private celebrationId = 0;

  private celebrate(kind: CelebrationKind): void {
    if (this.aiPlayed()) return;
    this.celebration.set({ id: ++this.celebrationId, kind });
  }

  private autoplayTimer: ReturnType<typeof setTimeout> | null = null;
  private autoplayLevel: AiLevel = 'expert';

  /** Mevcut taşları YZ için değer ızgarasına (number[][]) çevirir. */
  toValueGrid(): ValueGrid {
    const n = this.boardSize();
    const g = emptyGrid(n);
    for (const t of this.tiles()) g[t.row][t.col] = t.value;
    return g;
  }

  /**
   * YZ gösterimi başlamadan ÖNCEKİ oyun durumu.
   * YZ yalnızca bir örnektir: durdurulunca oyuncu kendi tahtasına,
   * kendi skoruna ve kendi süresine geri döner.
   */
  private preAiSnapshot: AiDemoSnapshot | null = null;

  /** Gösterim bitince YZ'nin ulaştığı skor (kısa süre gösterilir). */
  readonly aiDemoResult = signal<number | null>(null);
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
      keepPlayingAfterWin: this.keepPlayingAfterWin,
      history: this.history(),
      elapsedSeconds: this.elapsedSeconds(),
      remainingSeconds: this.remainingSeconds(),
      countdownTotal: this.countdownTotal,
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
    this.keepPlayingAfterWin = snap.keepPlayingAfterWin;
    this.history.set(snap.history);
    this.status.set(snap.status);
    this.assistHintsLeft.set(snap.assistHintsLeft);
    this.assistHintDir.set(null);
    this.clearPowerFx();

    // Süre de geri gelir: gösterim oyuncunun süresini yemez.
    this.countdownTotal = snap.countdownTotal;
    this.elapsedSeconds.set(snap.elapsedSeconds);
    this.remainingSeconds.set(snap.remainingSeconds);
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
    this.beginRecordedGame(this.randomSeed());
    this.cancelAutoplay(); // sürüyorsa gösterimi bitir, eski durumu ATMA
    this.paused.set(false);
    this.aiAssisted.set(false); // yeni seviye → temiz sayfa
    this.resetAssistHints();
    this.resetMoveReview();
    const cfg = levelConfig(this.level());
    this.boardSize.set(BOARD_SIZE); // seviye modu her zaman 4×4
    this.tiles.set([]);
    this.score.set(0);
    this.moves.set(0);
    this.lastReward.set(0);
    this.keepPlayingAfterWin = false;
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
    this.gameRng = null;
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
    this.keepPlayingAfterWin = false;
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
    this.keepPlayingAfterWin = snapshot.keepPlayingAfterWin;
    this.status.set(snapshot.status);

    // Tek adımlık geçmiş: geri aldıktan sonra tekrar geri alınamaz
    this.history.set(null);

    // Biten oyun (Kayıp/Başarısız/Kazanç) geri alma ile yeniden oynanır
    // hâle geldiyse sayaç da yeniden başlamalı. Aksi hâlde süre donmuş
    // kalır ve oyuncu sınırsız süreyle oynardı.
    if (snapshot.status === GameStatus.Playing) this.resumeTimerForMode();
    return true;
  }

  /** Mevcut moda uygun sayacı kaldığı yerden sürdürür. */
  private resumeTimerForMode(): void {
    const m = this.mode();
    if (m === GameMode.Zen) {
      this.stopTimer(); // süresiz mod
      return;
    }
    if (m === GameMode.Classic) {
      this.startTimer(this.elapsedSeconds()); // yukarı sayan
      return;
    }
    // Level / TimeAttack / Race / Daily → kalan süreden geri sayım
    this.startCountdown(this.remainingSeconds(), this.elapsedSeconds());
  }

  /** Kazandıktan sonra "Devam Et": oyuna geri dön, kazanmayı bir daha tetikleme. */
  continueAfterWin(): void {
    if (this.status() !== GameStatus.Won) return;
    this.keepPlayingAfterWin = true;
    this.status.set(GameStatus.Playing);
    // Süre kaldığı yerden devam etsin (donmuş değerden ileri)
    this.startTimer(this.elapsedSeconds());
  }

  // --- Altın ekonomisi ----------------------------------------

  /** Altın ekler (kazanç sayılır → toplam kazanç + görev). Altın durumu EconomyService'te. */
  addGold(amount: number): void {
    if (amount <= 0) return;
    this.economy.add(amount);
    this.trackMission('gold', amount); // görev: altın kazan (orkestrasyon çekirdekte)
  }

  /** Altın harcar. Yeterli değilse harcamaz. @returns başarılıysa true. */
  spendGold(amount: number): boolean {
    return this.economy.spend(amount);
  }

  // --- Güçler (mağaza + kullanım) -----------------------------

  /**
   * Bir gücü altınla satın alır (envantere ekler).
   * @returns satın alma başarılıysa true (yeterli altın vs.).
   */
  buyPower(id: PowerId): boolean {
    if (!this.spendGold(powerDef(id).price)) return false;
    this.powers.update((inv) => ({ ...inv, [id]: inv[id] + 1 }));
    savePowers(this.powers());
    return true;
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
    this.powers.update((inv) => ({ ...inv, [id]: Math.max(0, inv[id] - 1) }));
    savePowers(this.powers());
    this.trackMission('powers', 1); // görev: güç kullan
    // Güç kullanılan oyun şampiyonluk sıralamasına GİRMEZ (doğrulanamaz +
    // eşit şartlar). Yalnızca sıralama dışı bırakır; oyun normal devam eder.
    this.powerUsedThisGame.set(true);
  }

  /** +30 saniye: yalnızca seviye modunda ve oynanırken. */
  private applyAddTime(): boolean {
    if (this.mode() !== GameMode.Level) return false;
    this.countdownTotal += TIME_POWER_SECONDS;
    this.remainingSeconds.update((r) => r + TIME_POWER_SECONDS);
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

  /** Oyun başlangıcında günün aktivitesini kaydeder (seri). */
  private registerActivity(): void {
    const now = new Date();
    const today = dayKey(now);
    const yesterday = yesterdayKey(now);
    const next = streakAfterActivity(this.currentStreak(), this.lastActiveDay(), today, yesterday);
    this.currentStreak.set(next);
    if (next > this.bestStreak()) this.bestStreak.set(next);
    this.lastActiveDay.set(today);
    saveStreak(this.currentStreak(), this.bestStreak(), today);
    this.checkAchievements();
  }

  /**
   * Günlük ödülü alır (günde bir kez). Seriye göre altın verir.
   * @returns ödül alındıysa true.
   */
  claimDailyReward(): boolean {
    const today = dayKey(new Date());
    if (this.lastRewardDay() === today) return false; // bugün alınmış

    this.registerActivity(); // seriyi güncelle
    // 7 günlük döngü: seri sürdükçe ödül büyür, aralarda güç gelir.
    const reward = rewardForStreak(this.currentStreak());
    if (reward.gold > 0) this.addGold(reward.gold);
    if (reward.power) {
      this.powers.update((inv) => ({
        ...inv,
        [reward.power!]: inv[reward.power!] + reward.powerCount,
      }));
      savePowers(this.powers());
    }
    this.lastRewardDay.set(today);
    this.lastDailyReward.set(reward.gold);
    this.claimedReward.set(reward);
    saveDailyDay(today);
    this.celebrate('achievement'); // ödül alındı 🎉
    return true;
  }

  /** Bugün alınan ödülün ayrıntısı (arayüzde "ne kazandın" için). */
  readonly claimedReward = signal<DailyReward | null>(null);

  /**
   * Ay sonu şampiyonluk ödülünü envantere ekler.
   * Sunucu ödülün alındığını kendi tarafında işaretler; burada yalnızca
   * altın ve güçler eklenir (ardından bulut senkronu devreye girer).
   */
  grantChampionPrize(gold: number, powers: Record<string, number>): void {
    if (gold > 0) this.addGold(gold);
    const inv = { ...this.powers() };
    let changed = false;
    for (const [id, count] of Object.entries(powers ?? {})) {
      if (id in inv && typeof count === 'number' && count > 0) {
        inv[id as PowerId] += count;
        changed = true;
      }
    }
    if (changed) {
      this.powers.set(inv);
      savePowers(inv);
    }
    this.profile.addChampionship();
  }

  /** Kazanılan ay sonu şampiyonluğu sayısı (ProfileService'te). */
  readonly championships = this.profile.championships;

  /**
   * Bugün alınacak/alınan ödülün döngüdeki günü (1-7).
   * Ödül henüz alınmadıysa, alınınca serinin NE OLACAĞI hesaplanır —
   * böylece takvim doğru günü vurgular (seri kırıldıysa 1'e döner).
   */
  readonly rewardCycleDay = computed(() => {
    const now = new Date();
    const today = dayKey(now);
    const streak = this.canClaimDaily()
      ? streakAfterActivity(this.currentStreak(), this.lastActiveDay(), today, yesterdayKey(now))
      : this.currentStreak();
    return cycleDay(Math.max(1, streak));
  });

  /** 7 günlük ödül takvimi (arayüzde gösterilir). */
  readonly rewardCalendar = DAILY_REWARDS;

  /** Oyun sonunda istatistikleri günceller (istatistik ProfileService'te). */
  private recordGameEnd(won: boolean): void {
    if (this.aiPlayed()) return; // YZ oynadıysa ilerleme sayılmaz
    this.profile.recordGame(won, this.moves());
    this.checkAchievements();
    this.trackMission('games', 1);
    if (won) this.trackMission('wins', 1);
  }

  /** Tahtadaki en yüksek kareyi izler (başarım için). */
  private updateBestTile(): void {
    if (this.aiPlayed()) return; // YZ oynadıysa istatistik sayılmaz
    let max = this.bestTile();
    for (const t of this.tiles()) if (t.value > max) max = t.value;
    if (this.profile.reportBestTile(max)) this.checkAchievements();
  }

  /**
   * Bir başarımın ilerlemesi: `{ current, target }`.
   * Profilde "ne kadar yaklaştım" çubuğunu çizmek için kullanılır;
   * kilitli başarımlar artık sadece gri bir kutu değil.
   */
  achievementProgress(id: string): { current: number; target: number } {
    return this.achievements.progress(id, this.achStats());
  }

  /** Başarım koşullarının okuduğu anlık ilerleme görüntüsü (profil+ekonomi+seri). */
  private achStats(): AchievementStats {
    return {
      bestTile: this.bestTile(),
      bestLevel: this.bestLevel(),
      gamesPlayed: this.gamesPlayed(),
      bestStreak: this.bestStreak(),
      bombUsed: this.profile.bombUsed(),
      totalGoldEarned: this.totalGoldEarned(),
    };
  }

  /** Oyuncu ünvanı: toplam ilerlemeyi tek bir rütbeye indirger. */
  readonly rankInfo = computed(() =>
    rankFor(
      rankPoints({
        gamesPlayed: this.gamesPlayed(),
        bestScore: this.bestScore(),
        bestLevel: this.bestLevel(),
        achievements: this.unlockedAchievements().size,
      }),
    ),
  );

  /**
   * Koşulu sağlanan yeni başarımları açar (AchievementsService) ve ödül altınını
   * verip kutlamayı tetikler (orkestrasyon çekirdekte). Altın ödülü ayrıca "altın
   * kazan" görevini de ilerletir (addGold davranışı korunur).
   */
  private checkAchievements(): void {
    const newly = this.achievements.unlockNew(this.achStats());
    if (newly.length === 0) return;
    for (const a of newly) this.addGold(a.gold);
    this.celebrate('achievement'); // yeni başarım açıldı 🎉
  }

  // --- Görevler (façade → MissionsService) --------------------

  /**
   * Bir metrik için görev ilerlemesini bildirir. YZ oynadıysa (`aiPlayed`)
   * ilerleme sayılmaz — bu bayrağı MissionsService'e çekirdek geçer.
   */
  private trackMission(metric: MissionMetric, amount: number): void {
    this.missions.track(metric, amount, this.aiPlayed());
  }

  /** Tamamlanmış bir görevin ödülünü alır. */
  claimMission(id: string, type: 'daily' | 'weekly'): boolean {
    return this.missions.claim(id, type, this.aiPlayed());
  }

  /**
   * Verilen yöne hamle yapar.
   * - Izgara değişmediyse (geçersiz hamle) hiçbir şey yapmaz, yeni kare üretmez.
   * - Değiştiyse: skoru günceller ve yeni bir rastgele kare ekler.
   * @returns hamle geçerli olduysa true.
   */
  move(direction: Direction): boolean {
    if (this.status() !== GameStatus.Playing) return false;

    const result = applyMove(this.tiles(), direction, this.boardSize());
    if (!result.moved) return false; // geçersiz hamle → sayaç ARTMAZ

    // Doğrulama transkriptine ekle (yalnızca UYGULANAN hamleler).
    // Sunucu bu diziyi yeniden oynatıp skoru kendisi hesaplar.
    this.recordedMoves += MOVE_CHAR[direction];

    // Hamle kalitesi: YALNIZCA insan hamleleri, asistan açıkken ve tahta
    // henüz DEĞİŞMEDEN değerlendirilir (kıyas hamle öncesi pozisyona göre).
    if (this.assistantOn() && !this.autoplaying()) {
      const review = reviewMove(this.toValueGrid(), direction, 'medium');
      this.lastMoveReview.set(review);
      if (review) {
        this.moveRatings.update((r) => ({
          ...r,
          [review.rating]: r[review.rating] + 1,
        }));
      }
    }

    this.assistHintDir.set(null); // öneri yalnızca gösterildiği tahta içindi

    // Geçerli hamle → hamle ÖNCESİ durumu sakla (geri al için).
    // applyMove saf olduğundan this.tiles() hâlâ hamle öncesi listedir.
    // NOT: anlık görüntü hamle sayacı ARTMADAN alınır, böylece geri alınca
    // sayaç da doğru değere döner (istatistik şişmesi olmaz).
    this.history.set({
      tiles: this.tiles(),
      score: this.score(),
      moves: this.moves(),
      status: this.status(),
      keepPlayingAfterWin: this.keepPlayingAfterWin,
    });

    // Geçerli hamle → hamle sayısını artır.
    this.moves.update((m) => m + 1);

    // Yeni durum (birleşenlerde `merged` işaretli; `isNew` temizlenmiş olur)
    this.tiles.set(result.tiles);

    // Görev takibi: hamle + birleşme + kare hedefleri
    this.trackMission('moves', 1);
    const mergedTiles = result.tiles.filter((t) => t.merged);
    if (mergedTiles.length > 0) {
      this.trackMission('merges', mergedTiles.length);
      const maxMerged = Math.max(...mergedTiles.map((t) => t.value));
      if (maxMerged >= 256) this.trackMission('reach256', 1);
      if (maxMerged >= 512) this.trackMission('reach512', 1);
      if (maxMerged >= 1024) this.trackMission('reach1024', 1);
    }

    if (result.gained > 0) {
      this.score.update((s) => s + result.gained);
      this.updateBestScore();
    }

    // Her geçerli hamleden sonra yeni bir kare
    this.spawnRandomTile();
    this.updateBestTile(); // en yüksek kare istatistiği

    switch (this.mode()) {
      case GameMode.Level:
        this.checkLevelEnd();
        break;
      case GameMode.Classic:
        this.checkClassicEnd();
        break;
      // Zen & Zaman Yarışı: 2048'de durmaz; sadece hamle kalmayınca biter.
      // (Zaman Yarışı'nda süre dolması geri sayım içinde yönetilir.)
      default:
        this.checkEndlessEnd();
    }

    return true;
  }

  /** Klasik mod: 2048'e ulaşınca kazanma, hamle kalmayınca kaybetme. */
  private checkClassicEnd(): void {
    if (!this.keepPlayingAfterWin && this.tiles().some((t) => t.value >= WIN_VALUE)) {
      this.stopTimer(); // süre "tamamlama" anında donar
      this.status.set(GameStatus.Won);
      this.recordGameEnd(true);
      this.celebrate('win'); // 2048'e ulaşıldı 🎉
      return;
    }
    if (!hasAnyMove(this.tiles(), this.boardSize())) {
      this.stopTimer();
      this.status.set(GameStatus.Lost);
      this.recordGameEnd(false);
    }
  }

  /** Zen / Zaman Yarışı: kazanma yok; hamle kalmayınca oyun biter. */
  private checkEndlessEnd(): void {
    if (!hasAnyMove(this.tiles(), this.boardSize())) {
      this.stopTimer();
      this.status.set(GameStatus.Lost);
      this.recordGameEnd(false);
    }
  }

  /**
   * Seviye modu:
   * - Hedefe ulaşıldıysa → seviye tamamlandı (son seviyeyse tüm oyun kazanıldı).
   * - Hamle kalmadıysa → başarısız (süre dolması sayaç içinde yönetilir).
   */
  private checkLevelEnd(): void {
    if (this.tiles().some((t) => t.value >= this.levelTarget())) {
      this.stopTimer();
      // Ödül YALNIZCA ilk tamamlamada verilir; görev de yalnızca o zaman
      // ilerler (aynı seviyeyi tekrar bitirip görev çiftlemek engellenir).
      const firstTime = this.awardGold(this.level());
      if (firstTime) this.trackMission('levels', 1); // görev: seviye tamamla
      if (this.level() >= MAX_LEVEL) {
        this.status.set(GameStatus.Won);
        this.recordGameEnd(true); // tüm seviyeler bitti = kazanılmış oyun
        this.celebrate('win'); // tüm seviyeler tamamlandı 🎉
      } else {
        this.status.set(GameStatus.LevelComplete);
        this.celebrate('level'); // seviye geçildi 🎉
      }
      return;
    }
    if (!hasAnyMove(this.tiles(), this.boardSize())) {
      this.stopTimer();
      this.status.set(GameStatus.Failed); // Başarısız → altın YOK
      this.recordGameEnd(false);
    }
  }

  /**
   * Seviye tamamlanınca altın verir.
   * KURAL: Her seviyenin ödülü YALNIZCA İLK tamamlamada verilir.
   * Aynı seviye tekrar tamamlanırsa altın verilmez (farming önlenir).
   * `lastReward` = bu tamamlamada kazanılan altın (0 → zaten alınmıştı).
   */
  private awardGold(level: number): boolean {
    if (this.aiPlayed()) {
      this.lastReward.set(0); // YZ oynadıysa altın verilmez
      return false;
    }
    const reward = levelConfig(level).gold;
    if (this.rewardedLevels.has(level)) {
      this.lastReward.set(0); // ödül zaten alınmış
      return false;
    }
    this.rewardedLevels.add(level);
    this.addGold(reward);
    this.lastReward.set(reward);
    saveRewardedLevels(this.rewardedLevels);
    return true;
  }

  // --- Süre sayacı --------------------------------------------

  /** Süre sayacını başlatır (belirtilen saniyeden ileri sayar). */
  private startTimer(fromSeconds: number): void {
    this.stopTimer();
    this.elapsedSeconds.set(fromSeconds);
    this.startTimestamp = Date.now() - fromSeconds * 1000;

    // Tarayıcı dışı ortamda (SSR/test) setInterval yoksa sessizce geç.
    if (typeof setInterval === 'undefined') return;
    this.timerId = setInterval(() => {
      this.elapsedSeconds.set(Math.floor((Date.now() - this.startTimestamp) / 1000));
    }, 250);
  }

  /**
   * (Seviye modu) geri sayım: belirtilen saniyeden 0'a sayar.
   * 0'a ulaşınca — hâlâ oynanıyorsa — seviye başarısız olur.
   */
  private startCountdown(seconds: number, fromElapsed = 0): void {
    this.stopTimer();
    this.startTimestamp = Date.now();
    this.countdownTotal = seconds; // +30 gücü bunu artırabilir
    // Duraklat/devam ve geri alma sonrasında geçen süre sıfırlanmaz:
    // geri sayım kalan süreden, "geçen süre" göstergesi ise birikimden sürer.
    this.elapsedOffset = fromElapsed;
    this.elapsedSeconds.set(fromElapsed);
    this.remainingSeconds.set(seconds);

    if (typeof setInterval === 'undefined') return;
    this.timerId = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTimestamp) / 1000);
      this.elapsedSeconds.set(this.elapsedOffset + elapsed);
      const remaining = Math.max(0, this.countdownTotal - elapsed);
      this.remainingSeconds.set(remaining);

      if (remaining <= 0) {
        this.stopTimer();
        if (this.status() === GameStatus.Playing) {
          // Seviye modunda başarısız; Zaman Yarışı'nda oyun biter (skor kalır).
          if (this.mode() === GameMode.Level) {
            this.status.set(GameStatus.Failed);
            // Süreden kaybetmek de oynanmış bir oyundur: hamle kalmayınca
            // olduğu gibi burada da istatistik/görev sayılmalı.
            this.recordGameEnd(false);
          } else {
            this.status.set(GameStatus.Lost);
            this.recordGameEnd(false);
          }
        }
      }
    }, 250);
  }

  // --- Duraklat / Devam --------------------------------------

  /** Oyun duraklatıldı mı? (sayaç durur, giriş kilitlenir, tahta örtülür) */
  readonly paused = signal(false);

  /** Duraklat/Devam arasında geçiş (yalnızca oynanırken). */
  togglePause(): void {
    if (this.status() !== GameStatus.Playing) return;
    if (this.paused()) this.resumeGame();
    else this.pauseGame();
  }

  /** Oyunu duraklat: sayacı dondur. */
  pauseGame(): void {
    if (this.paused() || this.status() !== GameStatus.Playing) return;
    this.paused.set(true);
    this.stopTimer();
  }

  /** Oyuna devam et: sayacı kaldığı yerden sürdür. */
  resumeGame(): void {
    if (!this.paused()) return;
    this.paused.set(false);
    this.resumeTimerForMode();
  }

  /** Süre sayacını durdurur. */
  private stopTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  // --- Yardımcılar --------------------------------------------

  /** Boş hücrelerin konum listesini döndürür. */
  emptyCells(): Cell[] {
    const n = this.boardSize();
    const occupied = new Set(this.tiles().map((t) => t.row * n + t.col));
    const cells: Cell[] = [];
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (!occupied.has(row * n + col)) {
          cells.push({ row, col });
        }
      }
    }
    return cells;
  }

  /**
   * Rastgele boş bir hücreye yeni bir taş (2 veya 4) ekler.
   * Boş hücre yoksa null döner.
   */
  spawnRandomTile(): Tile | null {
    const cells = this.emptyCells();
    if (cells.length === 0) return null;

    const { row, col } = cells[Math.floor(this.rand() * cells.length)];
    const value = this.rand() < CHANCE_OF_FOUR ? 4 : 2;
    const tile: Tile = { id: this.nextId++, value, row, col, isNew: true };

    this.tiles.update((list) => [...list, tile]);
    return tile;
  }

  /** Anlık skor en yüksek skoru geçtiyse güncelle (ProfileService). */
  private updateBestScore(): void {
    if (this.aiPlayed()) return; // YZ oynadıysa rekor sayılmaz
    this.profile.reportBestScore(this.score());
  }
}
