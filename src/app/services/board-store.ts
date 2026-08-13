import { Injectable, computed, signal } from '@angular/core';
import { BOARD_SIZE, Cell, GameMode, GameStatus, Grid, Tile } from '../models/tile.model';
import { MOVE_CHAR } from '../logic/board-logic';
import { ValueGrid, emptyGrid, mulberry32 } from '../logic/ai';
import { levelConfig } from '../models/level.model';
import { Direction } from '../models/tile.model';

/** Yeni taşın 4 gelme olasılığı (kalan %90 → 2). */
const CHANCE_OF_FOUR = 0.1;

/** Geri al için saklanan tek adımlık oyun durumu. */
export interface GameSnapshot {
  tiles: Tile[];
  score: number;
  moves: number;
  status: GameStatus;
  keepPlayingAfterWin: boolean;
}

/**
 * Tahta durumu deposu (kernel): oyunun "kaynak gerçeği" olan ham per-oyun
 * durumu + tahta primitifleri. Bağımlılığı YOKTUR (yaprak). Motor (GameService),
 * süre, mod ve YZ servisleri bunu enjekte edip ORTAK durumu okur/yazar; böylece
 * bu servisler arasında döngüsel bağımlılık gerekmez.
 */
@Injectable({ providedIn: 'root' })
export class BoardStore {
  /** Taşlara benzersiz id vermek için artan sayaç. */
  private nextId = 1;

  /** Aktif oyunun tohumlu RNG'si (oyun yoksa Math.random). */
  private gameRng: (() => number) | null = null;

  /** Bu oyunda uygulanan hamlelerin dizisi ("U/D/L/R"). */
  private recordedMoves = '';

  // --- Durum sinyalleri (kaynak gerçeği) ----------------------

  /** Tahtadaki taşların listesi. */
  readonly tiles = signal<Tile[]>([]);
  /** Anlık skor. */
  readonly score = signal<number>(0);
  /** Bu oyunda yapılan geçerli hamle sayısı. */
  readonly moves = signal<number>(0);
  /** Oyunun anlık durumu. */
  readonly status = signal<GameStatus>(GameStatus.Idle);
  /** Oyun modu. */
  readonly mode = signal<GameMode>(GameMode.Classic);
  /** Anlık tahta boyutu (NxN). */
  readonly boardSize = signal<number>(BOARD_SIZE);
  /** (Seviye modu) anlık seviye. */
  readonly level = signal<number>(1);
  /** Aktif oyunun tohumu (doğrulama transkriptinde gönderilir). */
  readonly gameSeed = signal<number>(0);

  /** 2048'e ulaşıp "Devam Et" denildi mi? (kazanma tekrar tetiklenmesin) */
  readonly keepPlaying = signal<boolean>(false);

  /** Son hamleden ÖNCEKİ durum (tek adımlık geçmiş, geri al için). */
  readonly history = signal<GameSnapshot | null>(null);

  // --- Türetilmiş sinyaller -----------------------------------

  /** `tiles` listesinden üretilen NxN ızgara (okumak/çizmek için). */
  readonly grid = computed<Grid>(() => {
    const g = this.createEmptyGrid();
    for (const tile of this.tiles()) g[tile.row][tile.col] = tile;
    return g;
  });

  /** ŞU ANKİ tahtadaki en yüksek kare (tüm zamanların rekoru değil). */
  readonly currentBestTile = computed<number>(() =>
    this.tiles().reduce((max, t) => (t.value > max ? t.value : max), 0),
  );

  /** Boştaki hücre sayısı. */
  readonly emptyCount = computed<number>(
    () => this.boardSize() * this.boardSize() - this.tiles().length,
  );

  /**
   * Geri alınabilecek bir hamle var mı? Tohumlu modlarda (yarış + günlük)
   * geri alma yasak olduğundan buton da pasif olmalı.
   */
  readonly canUndo = computed<boolean>(
    () =>
      this.history() !== null && this.mode() !== GameMode.Race && this.mode() !== GameMode.Daily,
  );

  /** (Seviye modu) anlık seviyenin hedef karesi. */
  readonly levelTarget = computed<number>(() => levelConfig(this.level()).target);

  // --- Primitifler --------------------------------------------

  /** NxN boş ızgara üretir (tüm hücreler null). */
  createEmptyGrid(): Grid {
    const n = this.boardSize();
    return Array.from({ length: n }, () => Array.from({ length: n }, () => null));
  }

  /** Boş hücrelerin konum listesini döndürür. */
  emptyCells(): Cell[] {
    const n = this.boardSize();
    const occupied = new Set(this.tiles().map((t) => t.row * n + t.col));
    const cells: Cell[] = [];
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (!occupied.has(row * n + col)) cells.push({ row, col });
      }
    }
    return cells;
  }

  /** Rastgele boş bir hücreye yeni bir taş (2 veya 4) ekler. Boş yoksa null. */
  spawnRandomTile(): Tile | null {
    const cells = this.emptyCells();
    if (cells.length === 0) return null;
    const { row, col } = cells[Math.floor(this.rand() * cells.length)];
    const value = this.rand() < CHANCE_OF_FOUR ? 4 : 2;
    const tile: Tile = { id: this.nextId++, value, row, col, isNew: true };
    this.tiles.update((list) => [...list, tile]);
    return tile;
  }

  /** Mevcut taşları YZ için değer ızgarasına (number[][]) çevirir. */
  toValueGrid(): ValueGrid {
    const n = this.boardSize();
    const g = emptyGrid(n);
    for (const t of this.tiles()) g[t.row][t.col] = t.value;
    return g;
  }

  /** Aktif rastgelelik kaynağı (her oyun tohumlu; oyun yoksa Math.random). */
  private rand(): number {
    return this.gameRng ? this.gameRng() : Math.random();
  }

  /** Rastgele 32-bit tohum (tohumsuz modlar için). */
  randomSeed(): number {
    return Math.floor(Math.random() * 0x100000000) >>> 0;
  }

  /**
   * Yeni bir doğrulanabilir oyun kaydı başlatır: tohumu ayarlar, hamle kaydını
   * sıfırlar. Güç bayrağını çağıran taraf ayrıca sıfırlar.
   */
  beginRecordedGame(seed: number): void {
    const s = seed >>> 0;
    this.gameSeed.set(s);
    this.gameRng = mulberry32(s);
    this.recordedMoves = '';
  }

  /** Uygulanan bir hamleyi doğrulama transkriptine ekler. */
  recordMove(direction: Direction): void {
    this.recordedMoves += MOVE_CHAR[direction];
  }

  /** Sunucuya gönderilecek doğrulama transkripti. */
  gameTranscript(): { seed: number; moves: string; size: number } {
    return { seed: this.gameSeed(), moves: this.recordedMoves, size: this.boardSize() };
  }

  /** Tohumlu RNG'yi sıfırlar (ana ekrana dönüşte; sonraki rand Math.random olur). */
  clearRng(): void {
    this.gameRng = null;
  }
}
