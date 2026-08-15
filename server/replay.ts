// ============================================================
//  2048 — Sunucu tarafı oyun tekrarı (replay) DOĞRULAMA motoru (TypeScript).
//
//  NestJS backend'inin kullanacağı, çerçeveden BAĞIMSIZ port. İstemcideki
//  src/app/logic/replay.ts ve Python eşi server/replay.py ile BİREBİR aynı
//  davranır; parite testi (test_replay_parity.ts) ile 150 istemci
//  transkriptine karşı doğrulanır.
//
//  Tohum + hamle dizisinden oyunu yeniden oynatıp skoru KENDİMİZ hesaplarız;
//  istemcinin iddia ettiği skor kullanılmaz → skor tablosu hile yapılamaz.
//
//  Determinizm için mulberry32, JS'in 32-bit tam sayı semantiğiyle
//  (Math.imul, >>>, |0) çalışır. Angular'a bağımlı DEĞİLDİR (kendi kendine
//  yeter): Direction/CHAR_MOVE/mulberry32 burada gömülüdür.
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
  /** Hesaplanan skor (birleşen karelerin toplamı). */
  score: number;
  /** Ulaşılan en büyük kare. */
  maxTile: number;
  /** İşlenen (geçerli) hamle sayısı. */
  moves: number;
  /** Transkript geçerli mi? (geçersiz hamle/karakter → false) */
  valid: boolean;
}

/**
 * JS mulberry32 ile birebir aynı sözde-rastgele üretici (0..1).
 * İstemci ai.ts.mulberry32 ve Python replay.mulberry32 ile aynı bit deseni.
 */
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
 * Her kare en fazla bir kez birleşir. Dönen: yeni ızgara + kazanç + değişti mi.
 */
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
 * `moves`: "U/D/L/R" karakter dizisi. Geçersiz karakter veya tahtayı
 * değiştirmeyen hamle → valid=false (o ana kadarki skor/kare döner).
 */
export function replayGame(seed: number, moves: string, size: number): ReplayResult {
  const rand = mulberry32(seed >>> 0);
  let grid = Array.from({ length: size }, () => new Array(size).fill(0));

  // Oyun başı: iki taş (dört rand() çekimi)
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

/**
 * Gün anahtarından (YYYY-MM-DD) tohum — istemci dailySeed() ile birebir.
 * FNV-1a 32-bit. Günlük meydan okumada herkes AYNI tahtayı oynar; sunucu
 * tohumu kendisi hesaplar, oyuncu kolay bir tohum seçemez.
 */
export function dailySeed(day: string): number {
  let h = 2166136261;
  for (const ch of day) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}
