// ============================================================
//  2048 — Sunucu tarafı BOT motoru (expectimax) — bot_ai.py BİREBİR portu.
//  İstemci ai.ts botMove/playBotGame'in eşi. Sabit derinlik + tam-sayıya
//  yuvarlanmış ağırlıklar → tek transandantal (pow) sabitlenir, gerisi JS ile
//  birebir. Parite: test/bot.parity.spec.ts (server/bot_fixtures.json).
// ============================================================

import { mulberry32, moveGrid, emptyCells, spawn, maxOf, Direction } from '../replay/replay';

const CHANCE_OF_FOUR = 0.1;
const NO_MOVE_PENALTY = -1e15;
const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];
const DIR_CHAR: Record<Direction, string> = { up: 'U', down: 'D', left: 'L', right: 'R' };

export interface BotCfg {
  depth: number;
  sampleK: number;
  expandFour: boolean;
  snakePow: number;
  emptyMul: number;
}

/** Hamle temposu (ms) — güçlü seviye daha hızlı. app.py BOT_SPEED_MS birebir. */
export const BOT_SPEED_MS: Record<string, number> = {
  easy: 480, medium: 360, hard: 280, expert: 240,
  corner: 300, space: 330, hasty: 240, balanced: 300,
};

const BOT_CFG: Record<string, BotCfg> = {
  easy: { depth: 1, sampleK: 2, expandFour: true, snakePow: 1.0, emptyMul: 4 },
  medium: { depth: 2, sampleK: 1, expandFour: false, snakePow: 0.3, emptyMul: 1 },
  hard: { depth: 2, sampleK: 2, expandFour: true, snakePow: 1.0, emptyMul: 4 },
  expert: { depth: 3, sampleK: 2, expandFour: true, snakePow: 1.0, emptyMul: 4 },
};

/** Bot karakterleri — ai.ts BOT_CHARACTERS birebir. */
export const BOT_CHARACTERS: Record<string, BotCfg> = {
  corner: { depth: 2, sampleK: 2, expandFour: true, snakePow: 1.2, emptyMul: 1 },
  space: { depth: 2, sampleK: 2, expandFour: true, snakePow: 0.5, emptyMul: 8 },
  hasty: { depth: 1, sampleK: 2, expandFour: true, snakePow: 0.3, emptyMul: 1 },
  balanced: { depth: 2, sampleK: 2, expandFour: true, snakePow: 1.0, emptyMul: 4 },
};

/** Bot anahtarı bir karakter mi (level sütununda karakter/zorluk ayrımı). */
export function isCharacter(key: string | null | undefined): boolean {
  return !!key && key in BOT_CHARACTERS;
}

/** Anahtarı (zorluk VEYA karakter) ayara çözer. app.py resolve_cfg birebir. */
export function resolveCfg(key: string | null | undefined): BotCfg {
  if (key && key in BOT_CHARACTERS) return BOT_CHARACTERS[key];
  return BOT_CFG[key as string] ?? BOT_CFG['medium'];
}

const weightCache = new Map<string, number[][]>();

/** ai.ts snakeWeights: yılan gradyanı floor(base^(idx·pow)+0.5). */
function snakeWeights(n: number, pow: number): number[][] {
  const key = `${n}|${pow}`;
  const cached = weightCache.get(key);
  if (cached) return cached;
  const base = n >= 5 ? 3 : 4;
  const w = Array.from({ length: n }, () => new Array(n).fill(0));
  let idx = n * n - 1;
  for (let r = 0; r < n; r++) {
    const cols =
      r % 2 === 0
        ? Array.from({ length: n }, (_, i) => i)
        : Array.from({ length: n }, (_, i) => n - 1 - i);
    for (const c of cols) {
      w[r][c] = Math.floor(Math.pow(base, idx * pow) + 0.5);
      idx--;
    }
  }
  weightCache.set(key, w);
  return w;
}

/** Izgarayı puanlar — ai.ts evaluate birebir (tam-sayı). */
function evaluate(g: number[][], snakePow: number, emptyMul: number): number {
  const n = g.length;
  const w = snakeWeights(n, snakePow);
  let weighted = 0;
  let empties = 0;
  let maxVal = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const v = g[r][c];
      if (v === 0) {
        empties++;
        continue;
      }
      weighted += v * w[r][c];
      if (v > maxVal) maxVal = v;
    }
  }
  return weighted + empties * maxVal * emptyMul;
}

/** ai.ts sampleCells: eşit aralıklı k hücre (deterministik). */
function sampleCells(cells: Array<[number, number]>, k: number): Array<[number, number]> {
  const step = cells.length / k;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < k; i++) out.push(cells[Math.floor(i * step)]);
  return out;
}

function place(g: number[][], r: number, c: number, v: number): number[][] {
  const out = g.map((row) => row.slice());
  out[r][c] = v;
  return out;
}

function maxNode(g: number[][], depth: number, cfg: BotCfg): number {
  if (depth === 0) return evaluate(g, cfg.snakePow, cfg.emptyMul);
  let best: number | null = null;
  for (const d of DIRECTIONS) {
    const { moved, grid: nxt } = moveGrid(g, d);
    if (!moved) continue;
    const v = chanceNode(nxt, depth - 1, cfg);
    if (best === null || v > best) best = v;
  }
  return best === null ? NO_MOVE_PENALTY : best;
}

function chanceNode(g: number[][], depth: number, cfg: BotCfg): number {
  if (depth === 0) return evaluate(g, cfg.snakePow, cfg.emptyMul);
  const cells = emptyCells(g);
  if (cells.length === 0) return evaluate(g, cfg.snakePow, cfg.emptyMul);
  const k = cfg.sampleK;
  const sample = cells.length > k ? sampleCells(cells, k) : cells;
  let total = 0;
  const per = 1 / sample.length;
  for (const [r, c] of sample) {
    if (cfg.expandFour) {
      total += per * 0.9 * maxNode(place(g, r, c, 2), depth, cfg);
      total += per * CHANCE_OF_FOUR * maxNode(place(g, r, c, 4), depth, cfg);
    } else {
      total += per * maxNode(place(g, r, c, 2), depth, cfg);
    }
  }
  return total;
}

/** Sabit derinlikte deterministik expectimax hamlesi. ai.ts botMoveCfg eşi. */
export function botMoveCfg(g: number[][], cfg: BotCfg): Direction | null {
  const legal = DIRECTIONS.filter((d) => moveGrid(g, d).moved);
  if (legal.length === 0) return null;
  if (legal.length === 1) return legal[0];
  let best = legal[0];
  let bestVal: number | null = null;
  for (const d of legal) {
    const { grid: nxt } = moveGrid(g, d);
    const v = chanceNode(nxt, cfg.depth - 1, cfg);
    if (bestVal === null || v > bestVal) {
      bestVal = v;
      best = d;
    }
  }
  return best;
}

export interface BotGameResult {
  moves: string;
  scores: number[];
  bests: number[];
  maxTile: number;
  finalScore: number;
}

/**
 * Tohumdan botun oyununu oynatır; skor ZAMAN çizelgesini döndürür.
 * app.py play_bot_game / ai.ts playBotGame birebir. `onProgress` verilirse
 * her `progressEvery` hamlede (ve bitişte) çağrılır (artımlı yayın).
 */
export function playBotGame(
  seed: number,
  level: string,
  maxMoves: number,
  size = 4,
  onProgress?: (scores: number[], bests: number[]) => void,
  progressEvery = 32,
): BotGameResult {
  const cfg = resolveCfg(level);
  const rand = mulberry32(seed >>> 0);
  let grid = Array.from({ length: size }, () => new Array(size).fill(0));
  spawn(grid, rand);
  spawn(grid, rand);

  const moves: string[] = [];
  const scores = [0];
  const bests = [maxOf(grid)];
  let score = 0;
  for (let i = 0; i < maxMoves; i++) {
    const d = botMoveCfg(grid, cfg);
    if (d === null) break;
    const res = moveGrid(grid, d);
    if (!res.moved) break;
    grid = res.grid;
    score += res.gained;
    moves.push(DIR_CHAR[d]);
    spawn(grid, rand);
    scores.push(score);
    bests.push(maxOf(grid));
    if (onProgress && (i + 1) % progressEvery === 0) onProgress(scores, bests);
  }
  if (onProgress) onProgress(scores, bests);
  return { moves: moves.join(''), scores, bests, maxTile: maxOf(grid), finalScore: score };
}

/** Yarış süresini kaplayacak hamle sayısı (+tampon). app.py _bot_max_moves. */
export function botMaxMoves(level: string, duration: number): number {
  const speed = BOT_SPEED_MS[level] ?? 360;
  return Math.floor((duration * 1000) / speed) + 6;
}
