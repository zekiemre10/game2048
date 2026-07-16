import { Injectable, computed, signal } from '@angular/core';
import {
  BOARD_SIZE,
  Cell,
  Direction,
  Grid,
  GameMode,
  GameStatus,
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

/** Ödülü alınmış seviyelerin localStorage anahtarı. */
const REWARDED_LEVELS_KEY = 'game2048.rewardedLevels';

/** Güç envanterinin localStorage anahtarı. */
const POWERS_KEY = 'game2048.powers';

/** +30 saniye gücünün eklediği süre. */
const TIME_POWER_SECONDS = 30;

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

  /** Oyun modu (klasik / seviye). */
  readonly mode = signal<GameMode>(GameMode.Classic);

  /** (Seviye modu) anlık seviye. */
  readonly level = signal<number>(1);

  /** Ulaşılan en yüksek seviye (localStorage'da kalıcı). */
  readonly bestLevel = signal<number>(loadBestLevel());

  /** Toplam altın (hesapta kalıcı). */
  readonly gold = signal<number>(loadGold());

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

  /** (Seviye modu) anlık seviyenin hedef karesi. */
  readonly levelTarget = computed<number>(() => levelConfig(this.level()).target);

  /** Son hamleden ÖNCEKİ durum (tek adımlık geçmiş). */
  private readonly history = signal<GameSnapshot | null>(null);

  /** Geri alınabilecek bir hamle var mı? */
  readonly canUndo = computed<boolean>(() => this.history() !== null);

  // --- Türetilmiş sinyaller -----------------------------------

  /** `tiles` listesinden üretilen 4×4 ızgara (okumak/çizmek için). */
  readonly grid = computed<Grid>(() => {
    const g = this.createEmptyGrid();
    for (const tile of this.tiles()) {
      g[tile.row][tile.col] = tile;
    }
    return g;
  });

  /** Boştaki hücre sayısı (hamle üretmek/oyun sonu için). */
  readonly emptyCount = computed<number>(
    () => BOARD_SIZE * BOARD_SIZE - this.tiles().length,
  );

  // --- Fabrika / kurulum fonksiyonları ------------------------

  /** 4×4 boş ızgara üretir (tüm hücreler null). */
  createEmptyGrid(): Grid {
    return Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => null),
    );
  }

  /** Klasik (sonsuz) oyunu başlatır: boş tahta + 2 rastgele taş, süre yukarı sayar. */
  startGame(): void {
    this.mode.set(GameMode.Classic);
    this.tiles.set([]);
    this.score.set(0);
    this.moves.set(0); // hamle sayacı sıfırlanır
    this.keepPlayingAfterWin = false;
    this.history.set(null); // geçmişi de sıfırla
    this.clearPowerFx();
    this.status.set(GameStatus.Playing);
    this.spawnRandomTile();
    this.spawnRandomTile();
    this.startTimer(0); // süre sıfırdan başlar
  }

  // --- Seviye modu --------------------------------------------

  /** Seviye modunu 1. seviyeden başlatır. */
  startLevelMode(): void {
    this.mode.set(GameMode.Level);
    this.level.set(1);
    this.startLevel();
  }

  /** Anlık seviyeyi (yeniden) başlatır: boş tahta + geri sayım. */
  private startLevel(): void {
    const cfg = levelConfig(this.level());
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

  // --- Güçler (mağaza + kullanım) -----------------------------

  /**
   * Bir gücü altınla satın alır (envantere ekler).
   * @returns satın alma başarılıysa true (yeterli altın vs.).
   */
  buyPower(id: PowerId): boolean {
    const price = powerDef(id).price;
    if (this.gold() < price) return false;

    this.gold.update((g) => g - price);
    this.powers.update((inv) => ({ ...inv, [id]: inv[id] + 1 }));
    saveGold(this.gold());
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
    return true;
  }

  /** Bomba modunu iptal eder (güç harcanmaz). */
  cancelBomb(): void {
    this.bombMode.set(false);
  }

  private consumePower(id: PowerId): void {
    this.powers.update((inv) => ({ ...inv, [id]: Math.max(0, inv[id] - 1) }));
    savePowers(this.powers());
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
    const cells: Cell[] = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) cells.push({ row: r, col: c });
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
    for (const dir of dirs) {
      const res = applyMove(this.tiles(), dir);
      if (!res.moved) continue;
      const empty = BOARD_SIZE * BOARD_SIZE - res.tiles.length;
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

  /**
   * Verilen yöne hamle yapar.
   * - Izgara değişmediyse (geçersiz hamle) hiçbir şey yapmaz, yeni kare üretmez.
   * - Değiştiyse: skoru günceller ve yeni bir rastgele kare ekler.
   * @returns hamle geçerli olduysa true.
   */
  move(direction: Direction): boolean {
    if (this.status() !== GameStatus.Playing) return false;

    const result = applyMove(this.tiles(), direction);
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

    if (result.gained > 0) {
      this.score.update((s) => s + result.gained);
      this.updateBestScore();
    }

    // Her geçerli hamleden sonra yeni bir kare
    this.spawnRandomTile();

    if (this.mode() === GameMode.Level) {
      this.checkLevelEnd();
    } else {
      this.checkClassicEnd();
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
      return;
    }
    if (!hasAnyMove(this.tiles())) {
      this.stopTimer();
      this.status.set(GameStatus.Lost);
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
      this.status.set(
        this.level() >= MAX_LEVEL ? GameStatus.Won : GameStatus.LevelComplete,
      );
      return;
    }
    if (!hasAnyMove(this.tiles())) {
      this.stopTimer();
      // Başarısız → altın YOK
      this.status.set(GameStatus.Failed);
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
    this.gold.update((g) => g + reward);
    this.lastReward.set(reward);
    saveGold(this.gold());
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
          this.status.set(GameStatus.Failed); // süre doldu
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
    const occupied = new Set(
      this.tiles().map((t) => t.row * BOARD_SIZE + t.col),
    );
    const cells: Cell[] = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (!occupied.has(row * BOARD_SIZE + col)) {
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
