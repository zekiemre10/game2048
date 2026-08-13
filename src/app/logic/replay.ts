import { Direction } from '../models/tile.model';
import { mulberry32 } from './ai';
import { CHAR_MOVE } from './board-logic';

// ============================================================
//  2048 — Oyun tekrarı (replay) — DOĞRULAMA ÇEKİRDEĞİ
//
//  Tohum + hamle dizisinden oyunu birebir yeniden oynatıp skoru
//  hesaplar. GameService'in taş üretimi/hamle mantığıyla AYNI olmalı;
//  aksi hâlde meşru oyunlar reddedilir (yanlış pozitif).
//
//  Sunucu tarafındaki Python eşi (server/replay.py) bu dosyayı birebir
//  yansıtır — parite testiyle doğrulanır.
//
//  Determinizm kuralları (GameService ile birebir):
//   • Boş hücreler SATIR-ÖNCELİKLİ sırada (row 0..n, col 0..n).
//   • Taş üretimi: cell = floor(rand()*len), sonra value = rand()<0.1?4:2.
//     → her üretim İKİ rand() çeker.
//   • Oyun başı: iki taş üretilir (dört rand() çekimi).
//   • Yalnızca GEÇERLİ (tahtayı değiştiren) hamleler işlenir; her geçerli
//     hamleden sonra bir taş üretilir.
// ============================================================

const CHANCE_OF_FOUR = 0.1;

export interface ReplayResult {
  /** Hesaplanan skor (birleşen karelerin toplamı). */
  score: number;
  /** Ulaşılan en büyük kare. */
  maxTile: number;
  /** İşlenen (geçerli) hamle sayısı. */
  moves: number;
  /** Transkript geçerli mi? (geçersiz hamle/karakter → false) */
  valid: boolean;
}

/** Boş hücreler — satır öncelikli (GameService.emptyCells ile aynı sıra). */
function emptyCells(grid: number[][]): Array<[number, number]> {
  const n = grid.length;
  const out: Array<[number, number]> = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (grid[r][c] === 0) out.push([r, c]);
  return out;
}

/** Bir taş üretir (iki rand() çekimi). Boş hücre yoksa hiçbir şey yapmaz. */
function spawn(grid: number[][], rand: () => number): void {
  const cells = emptyCells(grid);
  if (cells.length === 0) return;
  const [r, c] = cells[Math.floor(rand() * cells.length)];
  grid[r][c] = rand() < CHANCE_OF_FOUR ? 4 : 2;
}

/**
 * Bir yönde kaydırıp birleştirir (SAF, değer ızgarası üzerinde).
 * `board-logic.ts` slideLine mantığının değer eşdeğeri:
 * her kare en fazla bir kez birleşir.
 */
export function moveGrid(
  grid: number[][],
  dir: Direction,
): { grid: number[][]; gained: number; moved: boolean } {
  const n = grid.length;
  const horizontal = dir === Direction.Left || dir === Direction.Right;
  const towardStart = dir === Direction.Left || dir === Direction.Up;
  const next = Array.from({ length: n }, () => new Array(n).fill(0));
  let gained = 0;

  for (let line = 0; line < n; line++) {
    // İtilen kenardan içeri doğru sıralı değerler (0'lar atılır)
    const vals: number[] = [];
    for (let i = 0; i < n; i++) {
      const idx = towardStart ? i : n - 1 - i;
      const v = horizontal ? grid[line][idx] : grid[idx][line];
      if (v !== 0) vals.push(v);
    }
    // Birleştir (bir kez)
    const merged: number[] = [];
    let mergedFlag = false;
    for (let i = 0; i < vals.length; i++) {
      if (merged.length > 0 && !mergedFlag && merged[merged.length - 1] === vals[i]) {
        merged[merged.length - 1] *= 2;
        gained += merged[merged.length - 1];
        mergedFlag = true;
      } else {
        merged.push(vals[i]);
        mergedFlag = false;
      }
    }
    // Yerleştir
    for (let i = 0; i < merged.length; i++) {
      const idx = towardStart ? i : n - 1 - i;
      if (horizontal) next[line][idx] = merged[i];
      else next[idx][line] = merged[i];
    }
  }

  // Değişti mi?
  let moved = false;
  for (let r = 0; r < n && !moved; r++)
    for (let c = 0; c < n; c++)
      if (grid[r][c] !== next[r][c]) {
        moved = true;
        break;
      }

  return { grid: next, gained, moved };
}

/**
 * Tohum + hamle dizisini yeniden oynatıp skoru hesaplar.
 * `moves`: "U/D/L/R" karakter dizisi (yalnızca geçerli hamleler).
 */
export function replayGame(seed: number, moves: string, size: number): ReplayResult {
  const rand = mulberry32(seed >>> 0);
  let grid = Array.from({ length: size }, () => new Array(size).fill(0));

  // Oyun başı: iki taş
  spawn(grid, rand);
  spawn(grid, rand);

  let score = 0;
  let count = 0;

  for (const ch of moves) {
    const dir = CHAR_MOVE[ch];
    if (dir === undefined) return invalid(grid, score, count);
    const res = moveGrid(grid, dir);
    if (!res.moved) return invalid(grid, score, count); // sahte/bozuk transkript
    grid = res.grid;
    score += res.gained;
    count++;
    spawn(grid, rand);
  }

  return { score, maxTile: maxOf(grid), moves: count, valid: true };
}

function invalid(grid: number[][], score: number, moves: number): ReplayResult {
  return { score, maxTile: maxOf(grid), moves, valid: false };
}

function maxOf(grid: number[][]): number {
  let m = 0;
  for (const row of grid) for (const v of row) if (v > m) m = v;
  return m;
}
