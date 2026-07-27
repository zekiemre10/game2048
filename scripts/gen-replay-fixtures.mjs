// ============================================================
//  Parite altın-kaynağı üreteci (bağımsız Node scripti).
//  replay.ts primitifleriyle AYNI mantığı kullanır; rastgele oyunlar
//  oynayıp transkriptleri iki dosyaya yazar:
//   • server/replay_fixtures.json          → Python parite testi okur
//   • src/app/logic/replay.fixtures.generated.ts → TS parite testi import eder
//
//  ZİNCİR: replay.ts (TS) == bu üreteç  [TS parite testi]
//          Python replay == bu üreteç   [Python parite testi]
//          replay.ts == gerçek oyun      [game.service.replay.spec]
//          ⟹ Python == gerçek oyun.
//
//  Üretim SABİT tohumla → fixture kararlı.
// ============================================================
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHANCE_OF_FOUR = 0.1;
const MOVE_CHAR = { up: 'U', down: 'D', left: 'L', right: 'R' };
const DIRS = ['up', 'down', 'left', 'right'];

// --- replay.ts ile birebir aynı primitifler ---
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function emptyCells(g) {
  const out = [];
  for (let r = 0; r < g.length; r++)
    for (let c = 0; c < g.length; c++) if (g[r][c] === 0) out.push([r, c]);
  return out;
}

function spawn(g, rand) {
  const cells = emptyCells(g);
  if (!cells.length) return;
  const [r, c] = cells[Math.floor(rand() * cells.length)];
  g[r][c] = rand() < CHANCE_OF_FOUR ? 4 : 2;
}

function moveGrid(grid, dir) {
  const n = grid.length;
  const horizontal = dir === 'left' || dir === 'right';
  const towardStart = dir === 'left' || dir === 'up';
  const next = Array.from({ length: n }, () => new Array(n).fill(0));
  let gained = 0;
  for (let line = 0; line < n; line++) {
    const vals = [];
    for (let i = 0; i < n; i++) {
      const idx = towardStart ? i : n - 1 - i;
      const v = horizontal ? grid[line][idx] : grid[idx][line];
      if (v !== 0) vals.push(v);
    }
    const merged = [];
    let mergedFlag = false;
    for (const v of vals) {
      if (merged.length && !mergedFlag && merged[merged.length - 1] === v) {
        merged[merged.length - 1] *= 2;
        gained += merged[merged.length - 1];
        mergedFlag = true;
      } else {
        merged.push(v);
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
      if (grid[r][c] !== next[r][c]) { moved = true; break; }
  return { grid: next, gained, moved };
}

function maxOf(g) {
  let m = 0;
  for (const row of g) for (const v of row) if (v > m) m = v;
  return m;
}

function playGame(seed, size, picker) {
  const rand = mulberry32(seed >>> 0);
  let grid = Array.from({ length: size }, () => new Array(size).fill(0));
  spawn(grid, rand);
  spawn(grid, rand);
  let moves = '';
  let score = 0;
  for (let step = 0; step < 5000; step++) {
    const valid = DIRS.filter((d) => moveGrid(grid, d).moved);
    if (!valid.length) break;
    const dir = valid[Math.floor(picker() * valid.length)];
    const res = moveGrid(grid, dir);
    grid = res.grid;
    score += res.gained;
    moves += MOVE_CHAR[dir];
    spawn(grid, rand);
  }
  return { seed, size, moves, score, maxTile: maxOf(grid) };
}

// --- Üret ---
const picker = mulberry32(0xabcdef);
const fixtures = [];
for (let i = 0; i < 150; i++) {
  const size = [3, 4, 5][Math.floor(picker() * 3)];
  const seed = Math.floor(picker() * 0x100000000) >>> 0;
  fixtures.push(playGame(seed, size, picker));
}

const long = fixtures.filter((f) => f.score > 1000).length;
if (long < 3) throw new Error('Yeterli uzun oyun yok — üreteç bozuk olabilir');

writeFileSync(
  resolve(__dirname, '../server/replay_fixtures.json'),
  JSON.stringify(fixtures),
);
writeFileSync(
  resolve(__dirname, '../src/app/logic/replay.fixtures.generated.ts'),
  '// OTOMATİK ÜRETİLDİ — scripts/gen-replay-fixtures.mjs. Elle düzenleme.\n' +
    'export interface ReplayFixture { seed: number; size: number; moves: string; score: number; maxTile: number; }\n' +
    'export const REPLAY_FIXTURES: ReplayFixture[] = ' +
    JSON.stringify(fixtures) +
    ';\n',
);

console.log(`${fixtures.length} fixture yazildi (${long} uzun oyun, en yuksek skor ${Math.max(...fixtures.map((f) => f.score))})`);
