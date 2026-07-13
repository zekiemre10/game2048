import { Injectable, computed, signal } from '@angular/core';
import {
  BOARD_SIZE,
  Cell,
  Direction,
  Grid,
  GameStatus,
  Tile,
} from '../models/tile.model';
import { applyMove, hasAnyMove } from '../logic/board-logic';

// ============================================================
//  2048 — Oyun servisi
//  Oyunun tüm durumu Angular signal'ları ile tutulur.
//  Kaynak gerçeği (source of truth): `tiles` — tahtadaki taşların
//  listesi. `grid` bu listeden türetilen 2B görünümdür.
// ============================================================

/** Yeni taşın 4 gelme olasılığı (kalan %90 → 2). */
const CHANCE_OF_FOUR = 0.1;

/** En yüksek skorun localStorage anahtarı. */
const BEST_SCORE_KEY = 'game2048.bestScore';

@Injectable({ providedIn: 'root' })
export class GameService {
  /** Taşlara benzersiz id vermek için artan sayaç. */
  private nextId = 1;

  // --- Durum sinyalleri ---------------------------------------

  /** Tahtadaki taşların listesi (kaynak gerçeği). */
  readonly tiles = signal<Tile[]>([]);

  /** Anlık skor. */
  readonly score = signal<number>(0);

  /** En yüksek skor (localStorage'dan yüklenir, değişince kaydedilir). */
  readonly bestScore = signal<number>(loadBestScore());

  /** Oyunun anlık durumu. */
  readonly status = signal<GameStatus>(GameStatus.Idle);

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

  /** Yeni oyunun başlangıç durumunu üretir: boş tahta + 2 rastgele taş. */
  startGame(): void {
    this.tiles.set([]);
    this.score.set(0);
    this.status.set(GameStatus.Playing);
    this.spawnRandomTile();
    this.spawnRandomTile();
  }

  /** Oyunu başlık ekranına döndürür. */
  reset(): void {
    this.tiles.set([]);
    this.score.set(0);
    this.status.set(GameStatus.Idle);
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
    if (!result.moved) return false;

    // Yeni durum (birleşenlerde `merged` işaretli; `isNew` temizlenmiş olur)
    this.tiles.set(result.tiles);

    if (result.gained > 0) {
      this.score.update((s) => s + result.gained);
      this.updateBestScore();
    }

    // Her geçerli hamleden sonra yeni bir kare
    this.spawnRandomTile();

    // Oyun sonu: yeni kareden sonra hiç hamle kalmadıysa kaybedildi.
    // (Kazandın/kaybettin EKRANLARI sonraki adımda; burada yalnızca
    //  durumu güncelleyip girişlerin kilitlenmesini sağlıyoruz.)
    if (!hasAnyMove(this.tiles())) {
      this.status.set(GameStatus.Lost);
    }

    return true;
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
