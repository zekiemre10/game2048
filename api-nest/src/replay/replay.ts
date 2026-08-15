// ============================================================
//  2048 — Sunucu tarafı oyun tekrarı (replay) DOĞRULAMA motoru.
//
//  Python server/replay.py ve istemci src/app/logic/replay.ts ile BİREBİR
//  aynı. Tohum + hamle dizisinden oyunu yeniden oynatıp skoru KENDİMİZ
//  hesaplarız; istemcinin iddia ettiği skor kullanılmaz → skor tablosu
//  hile yapılamaz. mulberry32 JS 32-bit semantiğiyle (Math.imul/>>>/|0).
//
//  Parite: test/replay.parity.spec.ts — server/replay_fixtures.json'daki
//  150 istemci transkripti için skor+maxTile birebir eşleşmeli.
// ============================================================

const CHANCE_OF_FOUR = 0.1;

export type Direction = 'up' | 'down' | 'left' | 'right';

/** Hamle karakteri → yön. İstemci board-logic.CHAR_MOVE ile birebir. */
const CHAR_MOVE: Record<string, Direction> = {
  U: 'up',
  D: 'down',
  L: 'left',
  R: 'right',
};

export interface ReplayResult {
  score: number;
  maxTile: number;
  moves: number;
  valid: boolean;
}

/** JS mulberry32 — istemci ai.ts ve Python replay.py ile aynı bit deseni. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Boş hücreler — satır öncelikli (istemci emptyCells ile aynı sıra). */
export function emptyCells(grid: number[][]): Array<[number, number]> {
  const n = grid.length;
  const out: Array<[number, number]> = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (grid[r][c] === 0) out.push([r, c]);
  return out;
}

/** Bir taş üretir (iki rand() çekimi). Boş hücre yoksa hiçbir şey yapmaz. */
export function spawn(grid: number[][], rand: () => number): void {
  const cells = emptyCells(grid);
  if (cells.length === 0) return;
  const [r, c] = cells[Math.floor(rand() * cells.length)];
  grid[r][c] = rand() < CHANCE_OF_FOUR ? 4 : 2;
}

/** Bir yönde kaydırıp birleştirir. Dönen: yeni ızgara + kazanç + değişti mi. */
export function moveGrid(
  grid: number[][],
  dir: Direction,
): { grid: number[][]; gained: number; moved: boolean } {
  const n = grid.length;
  const horizontal = dir === 'left' || dir === 'right';
  const towardStart = dir === 'left' || dir === 'up';
  const next = Array.from({ length: n }, () => new Array(n).fill(0));
  let gained = 0;

  for (let line = 0; line < n; line++) {
    const vals: number[] = [];
    for (let i = 0; i < n; i++) {
      const idx = towardStart ? i : n - 1 - i;
      const v = horizontal ? grid[line][idx] : grid[idx][line];
      if (v !== 0) vals.push(v);
    }
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
    for (let i = 0; i < merged.length; i++) {
      const idx = towardStart ? i : n - 1 - i;
      if (horizontal) next[line][idx] = merged[i];
      else next[idx][line] = merged[i];
    }
  }

  let moved = false;
  for (let r = 0; r < n && !moved; r++)
    for (let c = 0; c < n; c++)
      if (grid[r][c] !== next[r][c]) {
        moved = true;
        break;
      }

  return { grid: next, gained, moved };
}

/** Tohum + hamle dizisini yeniden oynatıp skoru hesaplar. */
export function replayGame(seed: number, moves: string, size: number): ReplayResult {
  const rand = mulberry32(seed >>> 0);
  let grid = Array.from({ length: size }, () => new Array(size).fill(0));

  spawn(grid, rand);
  spawn(grid, rand);

  let score = 0;
  let count = 0;

  for (const ch of moves) {
    const dir = CHAR_MOVE[ch];
    if (dir === undefined) return invalid(grid, score, count);
    const res = moveGrid(grid, dir);
    if (!res.moved) return invalid(grid, score, count);
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

export function maxOf(grid: number[][]): number {
  let m = 0;
  for (const row of grid) for (const v of row) if (v > m) m = v;
  return m;
}

/**
 * FNV-1a 32-bit tohum (istemci curatedDailySeed formül dalı / replay.py eşi).
 * Not: app.py günlük tohum için ÖNCE takvim (daily_calendar.json) bakar; bu
 * fonksiyon takvim dışı/olmayan günler için geri-düşüş formülüdür.
 */
export function fnvSeed(day: string): number {
  let h = 2166136261;
  for (const ch of day) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}
