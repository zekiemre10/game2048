import { Injectable, computed, signal } from '@angular/core';
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
import { applyMove, hasAnyMove } from '../logic/board-logic';
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
import { MAX_LEVEL, levelConfig } from '../models/level.model';
import {
  PowerId,
  PowerInventory,
  emptyInventory,
  powerDef,
} from '../models/power.model';
import { ACHIEVEMENTS } from '../models/achievement.model';
import {
  dailyRewardAmount,
  dayKey,
  streakAfterActivity,
  yesterdayKey,
} from '../logic/daily';
import {
  DAILY_COUNT,
  DAILY_POOL,
  MissionMetric,
  MissionProgress,
  WEEKLY_COUNT,
  WEEKLY_POOL,
  missionDef,
} from '../models/mission.model';
import { pickMissions, weekKey } from '../logic/missions';

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

/** En yüksek skorun localStorage anahtarı. */
const BEST_SCORE_KEY = 'game2048.bestScore';

/** Ulaşılan en yüksek seviyenin localStorage anahtarı. */
const BEST_LEVEL_KEY = 'game2048.bestLevel';

/** Toplam altının localStorage anahtarı. */
const GOLD_KEY = 'game2048.gold';

/** Bugüne kadar kazanılan toplam altının anahtarı. */
const TOTAL_EARNED_KEY = 'game2048.totalGoldEarned';

/** Ödülü alınmış seviyelerin localStorage anahtarı. */
const REWARDED_LEVELS_KEY = 'game2048.rewardedLevels';

/** Güç envanterinin localStorage anahtarı. */
const POWERS_KEY = 'game2048.powers';

/** +30 saniye gücünün eklediği süre. */
const TIME_POWER_SECONDS = 30;

/** Profil/meta localStorage anahtarları. */
const NAME_KEY = 'game2048.name';
const AVATAR_KEY = 'game2048.avatar';
const ASSISTANT_KEY = 'game2048.assistant';

/** Seçilebilir profil avatarları (ilk sıradaki varsayılan). */
export const AVATARS = [
  '👤', '😎', '🤖', '🐱', '🐉', '🌟', '🦊', '🐼',
  '👾', '🦁', '🐧', '🦄', '🍀', '🔥', '⚡', '🎩',
];
const STATS_KEY = 'game2048.stats';
const STREAK_KEY = 'game2048.streak';
const DAILY_KEY = 'game2048.dailyDay';
const ACHIEVEMENTS_KEY = 'game2048.achievements';
const DAILY_MISSIONS_KEY = 'game2048.dailyMissions';
const WEEKLY_MISSIONS_KEY = 'game2048.weeklyMissions';

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
  readonly bestScore = signal<number>(loadBestScore());

  /** Oyunun anlık durumu. */
  readonly status = signal<GameStatus>(GameStatus.Idle);

  /** Oyun modu (klasik / seviye / zen / zaman yarışı). */
  readonly mode = signal<GameMode>(GameMode.Classic);

  /** Anlık tahta boyutu (NxN). Seviye modu her zaman 4. */
  readonly boardSize = signal<number>(BOARD_SIZE);

  /** (Seviye modu) anlık seviye. */
  readonly level = signal<number>(1);

  /** Ulaşılan en yüksek seviye (localStorage'da kalıcı). */
  readonly bestLevel = signal<number>(loadBestLevel());

  /** Toplam altın (hesapta kalıcı). */
  readonly gold = signal<number>(loadGold());

  /** Bugüne kadar kazanılan toplam altın (başarım için). */
  readonly totalGoldEarned = signal<number>(loadTotalEarned());

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

  // --- Profil / istatistik / seri / başarım -------------------

  /** Oyuncu adı. */
  readonly playerName = signal<string>(loadName());

  /** Oynanan toplam oyun. */
  readonly gamesPlayed = signal<number>(loadStat('gamesPlayed'));
  /** Kazanılan oyun (2048'e ulaşma / tüm seviyeler). */
  readonly gamesWon = signal<number>(loadStat('gamesWon'));
  /** Ulaşılan en yüksek kare değeri. */
  readonly bestTile = signal<number>(loadStat('bestTile'));
  /** Toplam yapılan hamle. */
  readonly totalMoves = signal<number>(loadStat('totalMoves'));
  /** En az bir bomba kullanıldı mı? */
  private bombUsed = signal<boolean>(loadStat('bombUsed') === 1);

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
  readonly unlockedAchievements = signal<Set<string>>(loadAchievements());

  /** Günlük görevler (id, ilerleme, alındı). */
  readonly dailyMissions = signal<MissionProgress[]>([]);

  /** Haftalık görevler. */
  readonly weeklyMissions = signal<MissionProgress[]>([]);

  /** Alınmayı bekleyen (tamamlanmış ama alınmamış) görev sayısı. */
  readonly claimableMissions = computed<number>(() => {
    const count = (list: MissionProgress[]) =>
      list.filter((m) => {
        const def = missionDef(m.id);
        return def && !m.claimed && m.progress >= def.target;
      }).length;
    return count(this.dailyMissions()) + count(this.weeklyMissions());
  });

  /** Kazanma yüzdesi (0-100). */
  readonly winRate = computed<number>(() => {
    const played = this.gamesPlayed();
    return played === 0 ? 0 : Math.round((this.gamesWon() / played) * 100);
  });

  /** Bugün günlük ödül alınabilir mi? */
  readonly canClaimDaily = computed<boolean>(
    () => this.lastRewardDay() !== dayKey(new Date()),
  );

  /** (Seviye modu) anlık seviyenin hedef karesi. */
  readonly levelTarget = computed<number>(() => levelConfig(this.level()).target);

  /** Son hamleden ÖNCEKİ durum (tek adımlık geçmiş). */
  private readonly history = signal<GameSnapshot | null>(null);

  /** Geri alınabilecek bir hamle var mı? */
  readonly canUndo = computed<boolean>(() => this.history() !== null);

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
   * Yarış modunda ortak tohumlu RNG (tüm oyuncular aynı taş dizisini alır).
   * null ise normal `Math.random` kullanılır.
   */
  private raceRng: (() => number) | null = null;

  /** Aktif rastgelelik kaynağı (yarışta tohumlu, aksi halde Math.random). */
  private rand(): number {
    return this.raceRng ? this.raceRng() : Math.random();
  }

  constructor() {
    this.ensureMissionsFresh();
  }

  // --- Fabrika / kurulum fonksiyonları ------------------------

  /** NxN boş ızgara üretir (tüm hücreler null). */
  createEmptyGrid(): Grid {
    const n = this.boardSize();
    return Array.from({ length: n }, () =>
      Array.from({ length: n }, () => null),
    );
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
    this.raceRng = null; // normal oyun → gerçek rastgelelik
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
  startRace(seed: number, duration: number): void {
    this.cancelAutoplay();
    this.paused.set(false);
    this.aiAssisted.set(false); // yeni yarış → temiz sayfa
    this.resetAssistHints();
    this.resetMoveReview();
    this.raceRng = mulberry32(seed >>> 0);
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
    this.tiles.set(
      snap.tiles.map((t) => ({ id: t.id, value: t.value, row: t.row, col: t.col })),
    );
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
    this.raceRng = null;
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

    // Bu seviyeye ulaşıldı → en yüksek seviyeyi güncelle
    if (this.level() > this.bestLevel()) {
      this.bestLevel.set(this.level());
      saveBestLevel(this.level());
    }
  }

  /**
   * Ana (başlık) ekrana döner: oyunu durdurur, durumu Idle'a alır.
   * Böylece mod/tahta seçim ekranı yeniden görünür.
   */
  goHome(): void {
    this.cancelAutoplay(); // ana ekrana dönerken geri yüklenecek bir şey yok
    this.stopTimer();
    this.paused.set(false);
    this.raceRng = null;
    this.status.set(GameStatus.Idle);
  }

  /** Mevcut modu ve boyutu yeniden başlatır (Yeni Oyun / Baştan). */
  restartCurrent(): void {
    // Yarış sırasında "Yeni Oyun" YOK: tohumlu yarışı tohumsuz/süresiz bir
    // tek kişilik oyuna çevirip skoru sunucuya bildirmeye devam ederdi.
    if (this.mode() === GameMode.Race) return;
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
    // Yarışta geri alma YOK: tohumlu taş dizisi geri sarılamaz; geri alınca
    // oyuncunun taş akışı diğer yarışçılardan sapar (haksız yeniden çekiliş).
    if (this.mode() === GameMode.Race) return false;

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
    // Level / TimeAttack / Race → kalan süreden geri sayım
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

  /** Altın ekler (kazanç sayılır → toplam kazanç + başarım + görev). */
  addGold(amount: number): void {
    if (amount <= 0) return;
    this.gold.update((g) => g + amount);
    this.totalGoldEarned.update((t) => t + amount);
    saveGold(this.gold());
    saveTotalEarned(this.totalGoldEarned());
    this.trackMission('gold', amount); // görev: altın kazan
  }

  /** Altın harcar. Yeterli değilse harcamaz. @returns başarılıysa true. */
  spendGold(amount: number): boolean {
    if (this.gold() < amount) return false;
    this.gold.update((g) => g - amount);
    saveGold(this.gold());
    return true;
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

    this.tiles.update((list) =>
      list.filter((t) => !(t.row === row && t.col === col)),
    );
    this.consumePower('bomb');
    this.bombMode.set(false);
    // Geri alma bombalanan kareyi geri getirip gücü boşa harcatırdı.
    this.history.set(null);

    if (!this.bombUsed()) {
      this.bombUsed.set(true);
      this.saveStats();
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

  // --- Profil / istatistik / seri / günlük / başarım ----------

  /** Oyuncu adını ayarlar (kalıcı). */
  setName(name: string): void {
    const clean = name.trim().slice(0, 16) || 'Oyuncu';
    this.playerName.set(clean);
    saveName(clean);
  }

  /** Seçili profil avatarı (kalıcı + hesapla senkron). */
  readonly avatar = signal<string>(loadAvatar());

  /** Avatarı değiştirir; listede olmayan bir değer yok sayılır. */
  setAvatar(a: string): void {
    if (!AVATARS.includes(a)) return;
    this.avatar.set(a);
    saveAvatar(a);
  }

  // --- Hesap senkronizasyonu ----------------------------------

  /** Hesaba kaydedilecek ilerleme anlık görüntüsü. */
  accountSnapshot(): Record<string, unknown> {
    return {
      gold: this.gold(),
      totalGoldEarned: this.totalGoldEarned(),
      bestScore: this.bestScore(),
      bestLevel: this.bestLevel(),
      name: this.playerName(),
      avatar: this.avatar(),
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
      saveAvatar(d['avatar'] as string);
    }
    const gp = num(d['gamesPlayed']);
    if (gp !== null) this.gamesPlayed.set(gp);
    const gw = num(d['gamesWon']);
    if (gw !== null) this.gamesWon.set(gw);
    const bt = num(d['bestTile']);
    if (bt !== null) this.bestTile.set(bt);
    const tm = num(d['totalMoves']);
    if (tm !== null) this.totalMoves.set(tm);
    if (Array.isArray(d['achievements'])) {
      this.unlockedAchievements.set(
        new Set((d['achievements'] as unknown[]).filter((x) => typeof x === 'string') as string[]),
      );
    }
    // Kalıcı kaydet
    saveGold(this.gold());
    saveTotalEarned(this.totalGoldEarned());
    saveBestScore(this.bestScore());
    saveBestLevel(this.bestLevel());
    saveName(this.playerName());
    this.saveStats();
    saveAchievements(this.unlockedAchievements());
  }

  /** Oyun başlangıcında günün aktivitesini kaydeder (seri). */
  private registerActivity(): void {
    const now = new Date();
    const today = dayKey(now);
    const yesterday = yesterdayKey(now);
    const next = streakAfterActivity(
      this.currentStreak(),
      this.lastActiveDay(),
      today,
      yesterday,
    );
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
    const reward = dailyRewardAmount(this.currentStreak());
    this.addGold(reward);
    this.lastRewardDay.set(today);
    this.lastDailyReward.set(reward);
    saveDailyDay(today);
    return true;
  }

  /** Oyun sonunda istatistikleri günceller. */
  private recordGameEnd(won: boolean): void {
    if (this.aiPlayed()) return; // YZ oynadıysa ilerleme sayılmaz
    this.gamesPlayed.update((n) => n + 1);
    if (won) this.gamesWon.update((n) => n + 1);
    this.totalMoves.update((n) => n + this.moves());
    this.saveStats();
    this.checkAchievements();
    this.trackMission('games', 1);
    if (won) this.trackMission('wins', 1);
  }

  /** Tahtadaki en yüksek kareyi izler (başarım için). */
  private updateBestTile(): void {
    if (this.aiPlayed()) return; // YZ oynadıysa istatistik sayılmaz
    let max = this.bestTile();
    for (const t of this.tiles()) if (t.value > max) max = t.value;
    if (max !== this.bestTile()) {
      this.bestTile.set(max);
      this.saveStats();
      this.checkAchievements();
    }
  }

  /**
   * Bir başarımın ilerlemesi: `{ current, target }`.
   * Profilde "ne kadar yaklaştım" çubuğunu çizmek için kullanılır;
   * kilitli başarımlar artık sadece gri bir kutu değil.
   */
  achievementProgress(id: string): { current: number; target: number } {
    const clamp = (cur: number, target: number) => ({
      current: Math.min(cur, target),
      target,
    });
    switch (id) {
      case 'tile-512':
        return clamp(this.bestTile(), 512);
      case 'tile-1024':
        return clamp(this.bestTile(), 1024);
      case 'first-win':
        return clamp(this.bestTile(), WIN_VALUE);
      case 'level-3':
        return clamp(this.bestLevel(), 3);
      case 'games-10':
        return clamp(this.gamesPlayed(), 10);
      case 'streak-3':
        return clamp(this.bestStreak(), 3);
      case 'streak-7':
        return clamp(this.bestStreak(), 7);
      case 'bomb-use':
        return clamp(this.bombUsed() ? 1 : 0, 1);
      case 'rich':
        return clamp(this.totalGoldEarned(), 1000);
      default:
        return { current: 0, target: 1 };
    }
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

  /** Koşulu sağlanan yeni başarımları açar ve altın verir. */
  private checkAchievements(): void {
    let changed = false;
    for (const a of ACHIEVEMENTS) {
      if (this.unlockedAchievements().has(a.id)) continue;
      if (this.achievementMet(a.id)) {
        this.unlockedAchievements.update((s) => new Set(s).add(a.id));
        this.addGold(a.gold); // ödül (tekrar checkAchievements tetikler ama yakınsar)
        changed = true;
      }
    }
    if (changed) saveAchievements(this.unlockedAchievements());
  }

  private achievementMet(id: string): boolean {
    switch (id) {
      case 'tile-512':
        return this.bestTile() >= 512;
      case 'tile-1024':
        return this.bestTile() >= 1024;
      case 'first-win':
        return this.bestTile() >= WIN_VALUE;
      case 'level-3':
        return this.bestLevel() >= 3;
      case 'games-10':
        return this.gamesPlayed() >= 10;
      case 'streak-3':
        return this.bestStreak() >= 3;
      case 'streak-7':
        return this.bestStreak() >= 7;
      case 'bomb-use':
        return this.bombUsed();
      case 'rich':
        return this.totalGoldEarned() >= 1000;
      default:
        return false;
    }
  }

  private saveStats(): void {
    saveStats({
      gamesPlayed: this.gamesPlayed(),
      gamesWon: this.gamesWon(),
      bestTile: this.bestTile(),
      totalMoves: this.totalMoves(),
      bombUsed: this.bombUsed() ? 1 : 0,
    });
  }

  // --- Görevler (günlük + haftalık) ---------------------------

  /** En son tazelenen dönem — her çağrıda diskten okumayı önler. */
  private missionPeriod = { day: '', week: '' };

  /** Gün/hafta değiştiyse görevleri yeniden üretir (tohumlu, deterministik). */
  private ensureMissionsFresh(): void {
    const now = new Date();
    const today = dayKey(now);
    const week = weekKey(now);

    // Dönem değişmediyse iş yok (sık çağrılır: her hamlede).
    if (this.missionPeriod.day === today && this.missionPeriod.week === week) {
      return;
    }
    this.missionPeriod = { day: today, week };

    const daily = loadMissions(DAILY_MISSIONS_KEY);
    if (daily.period !== today) {
      const defs = pickMissions(DAILY_POOL, DAILY_COUNT, today);
      const list = defs.map((d) => ({ id: d.id, progress: 0, claimed: false }));
      this.dailyMissions.set(list);
      saveMissions(DAILY_MISSIONS_KEY, today, list);
    } else {
      this.dailyMissions.set(daily.list);
    }

    const weekly = loadMissions(WEEKLY_MISSIONS_KEY);
    if (weekly.period !== week) {
      const defs = pickMissions(WEEKLY_POOL, WEEKLY_COUNT, week);
      const list = defs.map((d) => ({ id: d.id, progress: 0, claimed: false }));
      this.weeklyMissions.set(list);
      saveMissions(WEEKLY_MISSIONS_KEY, week, list);
    } else {
      this.weeklyMissions.set(weekly.list);
    }
  }

  /** Bir metrik için görev ilerlemesini artırır (günlük + haftalık). */
  private trackMission(metric: MissionMetric, amount: number): void {
    if (amount <= 0) return;
    // Sekme gece yarısını aşarak açık kalmış olabilir: ilerlemeden önce
    // dönemi tazele, yoksa dünün görevleri ilerlemeye devam ederdi.
    this.ensureMissionsFresh();
    if (this.aiPlayed()) return; // YZ oynadıysa görevler ilerlemez
    this.bumpMissions(this.dailyMissions, DAILY_MISSIONS_KEY, metric, amount);
    this.bumpMissions(this.weeklyMissions, WEEKLY_MISSIONS_KEY, metric, amount);
  }

  private bumpMissions(
    sig: typeof this.dailyMissions,
    key: string,
    metric: MissionMetric,
    amount: number,
  ): void {
    let changed = false;
    const next = sig().map((m) => {
      const def = missionDef(m.id);
      if (!def || def.metric !== metric || m.claimed) return m;
      const progress = Math.min(def.target, m.progress + amount);
      if (progress !== m.progress) changed = true;
      return { ...m, progress };
    });
    if (changed) {
      sig.set(next);
      // period'u koru (bu gün/hafta)
      const stored = loadMissions(key);
      saveMissions(key, stored.period, next);
    }
  }

  /** Tamamlanmış bir görevin ödülünü alır. */
  claimMission(id: string, type: 'daily' | 'weekly'): boolean {
    this.ensureMissionsFresh(); // dün açık kalan sekmeden ödül alınmasın
    const sig = type === 'daily' ? this.dailyMissions : this.weeklyMissions;
    const key = type === 'daily' ? DAILY_MISSIONS_KEY : WEEKLY_MISSIONS_KEY;
    const def = missionDef(id);
    if (!def) return false;

    const mission = sig().find((m) => m.id === id);
    if (!mission || mission.claimed || mission.progress < def.target) {
      return false;
    }

    this.addGold(def.gold);
    const next = sig().map((m) => (m.id === id ? { ...m, claimed: true } : m));
    sig.set(next);
    const stored = loadMissions(key);
    saveMissions(key, stored.period, next);
    return true;
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
    if (
      !this.keepPlayingAfterWin &&
      this.tiles().some((t) => t.value >= WIN_VALUE)
    ) {
      this.stopTimer(); // süre "tamamlama" anında donar
      this.status.set(GameStatus.Won);
      this.recordGameEnd(true);
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
      } else {
        this.status.set(GameStatus.LevelComplete);
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
      this.elapsedSeconds.set(
        Math.floor((Date.now() - this.startTimestamp) / 1000),
      );
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

  /** Anlık skor en yüksek skoru geçtiyse güncelle ve kalıcı kaydet. */
  private updateBestScore(): void {
    if (this.aiPlayed()) return; // YZ oynadıysa rekor sayılmaz
    if (this.score() > this.bestScore()) {
      this.bestScore.set(this.score());
      saveBestScore(this.bestScore());
    }
  }
}

// ============================================================
//  En yüksek skor kalıcılığı (localStorage)
// ============================================================

/** localStorage'dan en yüksek skoru okur (yoksa/hatalıysa 0). */
function loadBestScore(): number {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem(BEST_SCORE_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** En yüksek skoru localStorage'a yazar (hata olursa sessizce geçer). */
function saveBestScore(best: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(BEST_SCORE_KEY, String(best));
  } catch {
    // Depolama kullanılamıyorsa (gizli mod, kota vb.) oyunu bozma
  }
}

/** localStorage'dan ulaşılan en yüksek seviyeyi okur (yoksa 0). */
function loadBestLevel(): number {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem(BEST_LEVEL_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Ulaşılan en yüksek seviyeyi localStorage'a yazar. */
function saveBestLevel(level: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(BEST_LEVEL_KEY, String(level));
  } catch {
    /* yoksay */
  }
}

/** localStorage'dan toplam altını okur (yoksa 0). */
function loadGold(): number {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem(GOLD_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Toplam altını localStorage'a yazar. */
function saveGold(gold: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(GOLD_KEY, String(gold));
  } catch {
    /* yoksay */
  }
}

/** Bugüne kadar kazanılan toplam altını okur. */
function loadTotalEarned(): number {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem(TOTAL_EARNED_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Toplam kazanılan altını yazar. */
function saveTotalEarned(total: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(TOTAL_EARNED_KEY, String(total));
  } catch {
    /* yoksay */
  }
}

/** Ödülü alınmış seviyelerin listesini localStorage'dan okur. */
function loadRewardedLevels(): number[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(REWARDED_LEVELS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

/** Ödülü alınmış seviyeleri localStorage'a yazar. */
function saveRewardedLevels(levels: Set<number>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(REWARDED_LEVELS_KEY, JSON.stringify([...levels]));
  } catch {
    /* yoksay */
  }
}

/** Güç envanterini localStorage'dan okur (yoksa boş). */
function loadPowers(): PowerInventory {
  const base = emptyInventory();
  try {
    if (typeof localStorage === 'undefined') return base;
    const raw = localStorage.getItem(POWERS_KEY);
    if (!raw) return base;
    const obj = JSON.parse(raw);
    for (const key of Object.keys(base) as (keyof PowerInventory)[]) {
      const n = obj?.[key];
      if (typeof n === 'number' && n >= 0) base[key] = Math.floor(n);
    }
    return base;
  } catch {
    return base;
  }
}

/** Güç envanterini localStorage'a yazar. */
function savePowers(inv: PowerInventory): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(POWERS_KEY, JSON.stringify(inv));
  } catch {
    /* yoksay */
  }
}

// --- Profil / istatistik / seri / günlük / başarım kalıcılık ---

function loadName(): string {
  try {
    return localStorage?.getItem(NAME_KEY) || 'Oyuncu';
  } catch {
    return 'Oyuncu';
  }
}

function saveName(name: string): void {
  try {
    localStorage?.setItem(NAME_KEY, name);
  } catch {
    /* yoksay */
  }
}

function loadAssistant(): boolean {
  try {
    return localStorage?.getItem(ASSISTANT_KEY) === '1';
  } catch {
    return false;
  }
}

function saveAssistant(on: boolean): void {
  try {
    localStorage?.setItem(ASSISTANT_KEY, on ? '1' : '0');
  } catch {
    /* yoksay */
  }
}

function loadAvatar(): string {
  try {
    const v = localStorage?.getItem(AVATAR_KEY);
    return v && AVATARS.includes(v) ? v : AVATARS[0];
  } catch {
    return AVATARS[0];
  }
}

function saveAvatar(a: string): void {
  try {
    localStorage?.setItem(AVATAR_KEY, a);
  } catch {
    /* yoksay */
  }
}

interface StatsBlob {
  gamesPlayed: number;
  gamesWon: number;
  bestTile: number;
  totalMoves: number;
  bombUsed: number;
}

function readStats(): Partial<StatsBlob> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STATS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadStat(key: keyof StatsBlob): number {
  const v = readStats()[key];
  return typeof v === 'number' && v >= 0 ? v : 0;
}

function saveStats(blob: StatsBlob): void {
  try {
    localStorage?.setItem(STATS_KEY, JSON.stringify(blob));
  } catch {
    /* yoksay */
  }
}

function readStreak(): { current?: number; best?: number; day?: string } {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STREAK_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadStreak(key: 'current' | 'best'): number {
  const v = readStreak()[key];
  return typeof v === 'number' && v >= 0 ? v : 0;
}

function loadStreakDay(): string | null {
  return readStreak().day ?? null;
}

function saveStreak(current: number, best: number, day: string): void {
  try {
    localStorage?.setItem(STREAK_KEY, JSON.stringify({ current, best, day }));
  } catch {
    /* yoksay */
  }
}

function loadDailyDay(): string | null {
  try {
    return localStorage?.getItem(DAILY_KEY) ?? null;
  } catch {
    return null;
  }
}

function saveDailyDay(day: string): void {
  try {
    localStorage?.setItem(DAILY_KEY, day);
  } catch {
    /* yoksay */
  }
}

function loadAchievements(): Set<string> {
  const set = new Set<string>();
  try {
    if (typeof localStorage === 'undefined') return set;
    const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr))
        for (const id of arr) if (typeof id === 'string') set.add(id);
    }
  } catch {
    /* yoksay */
  }
  return set;
}

function saveAchievements(set: Set<string>): void {
  try {
    localStorage?.setItem(ACHIEVEMENTS_KEY, JSON.stringify([...set]));
  } catch {
    /* yoksay */
  }
}

/** Görevleri okur: { period, list }. */
function loadMissions(key: string): {
  period: string | null;
  list: MissionProgress[];
} {
  try {
    if (typeof localStorage === 'undefined') return { period: null, list: [] };
    const raw = localStorage.getItem(key);
    if (!raw) return { period: null, list: [] };
    const obj = JSON.parse(raw);
    const list = Array.isArray(obj?.list)
      ? obj.list.filter(
          (m: unknown): m is MissionProgress =>
            !!m && typeof (m as MissionProgress).id === 'string',
        )
      : [];
    return { period: typeof obj?.period === 'string' ? obj.period : null, list };
  } catch {
    return { period: null, list: [] };
  }
}

/** Görevleri yazar. */
function saveMissions(
  key: string,
  period: string | null,
  list: MissionProgress[],
): void {
  try {
    localStorage?.setItem(key, JSON.stringify({ period, list }));
  } catch {
    /* yoksay */
  }
}
