// ============================================================
//  2048 — Bot koşucusu (çok oyunculu YZ rakibi)
//  Host tarayıcısında çalışır: ortak tohumlu bir oyunu expectimax
//  ile oynar, skorunu biriktirir. MultiplayerService bu skoru
//  sunucuya (/rooms/botprogress) bildirir.
// ============================================================

import {
  AiLevel,
  ValueGrid,
  bestMove,
  emptyCells,
  emptyGrid,
  isAiLevel,
  mulberry32,
  simulateMove,
} from './ai';

const CHANCE_OF_FOUR = 0.1;

/**
 * Botun zorluk seviyesini VERİDEN çözer (görünen addan DEĞİL).
 *
 * Eski `levelFromName` botun adında string arıyordu; ad çevrilince, biçimi
 * değişince ya da emoji eklenince seviye sessizce "medium"a düşüyordu — fark
 * edilmesi zor bir hata. Artık seviye veri olarak taşınır:
 *   1. `level`     — sunucunun oda durumunda döndürdüğü alan (asıl kaynak),
 *   2. `recorded`  — host'un botu eklerken kaydettiği seviye (sunucu bu alanı
 *                    henüz döndürmüyorsa köprü),
 *   3. `'medium'`  — geriye dönük güvenli varsayılan (eski odalardaki botlar).
 */
export function resolveBotLevel(level: unknown, recorded?: AiLevel): AiLevel {
  if (isAiLevel(level)) return level;
  if (isAiLevel(recorded)) return recorded;
  return 'medium';
}

/** Zorluğa göre hamle hızı (ms) — güçlü seviye daha hızlı/akıcı oynar. */
function speedFor(level: AiLevel): number {
  return level === 'easy' ? 480 : level === 'medium' ? 360 : level === 'hard' ? 280 : 240;
}

export class BotRunner {
  private grid: ValueGrid;
  /** Taş üretimi için tohumlu RNG — insan oyuncuyla birebir aynı akış. */
  private readonly rng: () => number;
  private readonly speedMs: number;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  score = 0;
  best = 0;
  done = false;

  constructor(
    seed: number,
    private readonly level: AiLevel,
    size = 4,
  ) {
    this.rng = mulberry32(seed >>> 0);
    this.speedMs = speedFor(level);
    this.grid = emptyGrid(size);
    // İnsanla aynı tohum → aynı iki başlangıç taşı (adil).
    this.spawn();
    this.spawn();
    this.updateBest();
  }

  /** Bota oynamaya başlat. */
  start(): void {
    this.schedule();
  }

  /** Botu durdur (yarış bitince veya oda kapanınca). */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private spawn(): void {
    const cells = emptyCells(this.grid);
    if (cells.length === 0) return;
    const [r, c] = cells[Math.floor(this.rng() * cells.length)];
    this.grid[r][c] = this.rng() < CHANCE_OF_FOUR ? 4 : 2;
  }

  private updateBest(): void {
    for (const row of this.grid)
      for (const v of row) if (v > this.best) this.best = v;
  }

  private schedule(): void {
    if (this.stopped) return;
    if (typeof setTimeout === 'undefined') return;
    this.timer = setTimeout(() => this.step(), this.speedMs);
  }

  private step(): void {
    if (this.stopped) return;
    const dir = bestMove(this.grid, this.level);
    if (!dir) {
      this.done = true;
      this.stop();
      return;
    }
    const { grid, moved, gained } = simulateMove(this.grid, dir);
    if (moved) {
      this.grid = grid;
      this.score += gained;
      this.spawn();
      this.updateBest();
    }
    this.schedule();
  }
}
