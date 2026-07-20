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
  status: GameStatus;
  keepPlayingAfterWin: boolean;
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

  /** Boştaki hücre sayısı (hamle üretmek/oyun sonu için). */
  readonly emptyCount = computed<number>(
    () => this.boardSize() * this.boardSize() - this.tiles().length,
  );

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

  /** Mevcut modu ve boyutu yeniden başlatır (Yeni Oyun / Baştan). */
  restartCurrent(): void {
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
    this.keepPlayingAfterWin = snapshot.keepPlayingAfterWin;
    this.status.set(snapshot.status);

    // Tek adımlık geçmiş: geri aldıktan sonra tekrar geri alınamaz
    this.history.set(null);
    return true;
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

    // Tüm hücreleri karıştır, ilk N tanesine değerleri yerleştir.
    const n = this.boardSize();
    const cells: Cell[] = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) cells.push({ row: r, col: c });
    }
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }

    // id'ler korunur → kareler yeni yerlerine kayarak animasyonla gider.
    const shuffled = current.map((t, i) => ({
      id: t.id,
      value: t.value,
      row: cells[i].row,
      col: cells[i].col,
    }));
    this.tiles.set(shuffled);
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

  /** En iyi yönü seçer: kazanılan puan + sonraki boş hücre sayısı en yüksek. */
  private computeHint(): Direction | null {
    const dirs = [
      Direction.Left,
      Direction.Right,
      Direction.Up,
      Direction.Down,
    ];
    let best: Direction | null = null;
    let bestScore = -1;
    const n = this.boardSize();
    for (const dir of dirs) {
      const res = applyMove(this.tiles(), dir, n);
      if (!res.moved) continue;
      const empty = n * n - res.tiles.length;
      const score = res.gained + empty; // basit sezgi
      if (score > bestScore) {
        bestScore = score;
        best = dir;
      }
    }
    return best;
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
    let max = this.bestTile();
    for (const t of this.tiles()) if (t.value > max) max = t.value;
    if (max !== this.bestTile()) {
      this.bestTile.set(max);
      this.saveStats();
      this.checkAchievements();
    }
  }

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

  /** Gün/hafta değiştiyse görevleri yeniden üretir (tohumlu, deterministik). */
  private ensureMissionsFresh(): void {
    const now = new Date();
    const today = dayKey(now);
    const week = weekKey(now);

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

    // Geçerli hamle → hamle sayısını artır.
    this.moves.update((m) => m + 1);

    // Geçerli hamle → hamle ÖNCESİ durumu sakla (geri al için).
    // applyMove saf olduğundan this.tiles() hâlâ hamle öncesi listedir.
    this.history.set({
      tiles: this.tiles(),
      score: this.score(),
      status: this.status(),
      keepPlayingAfterWin: this.keepPlayingAfterWin,
    });

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
      this.awardGold(this.level()); // seviye tamamlandı → altın ver
      this.trackMission('levels', 1); // görev: seviye tamamla
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
  private awardGold(level: number): void {
    const reward = levelConfig(level).gold;
    if (this.rewardedLevels.has(level)) {
      this.lastReward.set(0); // ödül zaten alınmış
      return;
    }
    this.rewardedLevels.add(level);
    this.addGold(reward);
    this.lastReward.set(reward);
    saveRewardedLevels(this.rewardedLevels);
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
  private startCountdown(seconds: number): void {
    this.stopTimer();
    this.startTimestamp = Date.now();
    this.countdownTotal = seconds; // +30 gücü bunu artırabilir
    this.elapsedSeconds.set(0);
    this.remainingSeconds.set(seconds);

    if (typeof setInterval === 'undefined') return;
    this.timerId = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTimestamp) / 1000);
      this.elapsedSeconds.set(elapsed);
      const remaining = Math.max(0, this.countdownTotal - elapsed);
      this.remainingSeconds.set(remaining);

      if (remaining <= 0) {
        this.stopTimer();
        if (this.status() === GameStatus.Playing) {
          // Seviye modunda başarısız; Zaman Yarışı'nda oyun biter (skor kalır).
          if (this.mode() === GameMode.Level) {
            this.status.set(GameStatus.Failed);
          } else {
            this.status.set(GameStatus.Lost);
            this.recordGameEnd(false);
          }
        }
      }
    }, 250);
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

    const { row, col } = cells[Math.floor(Math.random() * cells.length)];
    const value = Math.random() < CHANCE_OF_FOUR ? 4 : 2;
    const tile: Tile = { id: this.nextId++, value, row, col, isNew: true };

    this.tiles.update((list) => [...list, tile]);
    return tile;
  }

  /** Anlık skor en yüksek skoru geçtiyse güncelle ve kalıcı kaydet. */
  private updateBestScore(): void {
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
