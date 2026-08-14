// ============================================================
//  Bulmaca üretici (scripts/gen-puzzles.mjs) — DERLEME ZAMANI
//
//  Motor İÇERİK ÜRETİR: rastgele oyunlar oynatıp ilginç pozisyonları yakalar,
//  her pozisyonun çözülebilirliğini + ASGARİ çözüm hamlesini KENDİ arama motoruyla
//  (tam BFS/DFS, deterministik — taş üretimi YOK) doğrular ve hedef koyar.
//
//  Bulmacalar DETERMİNİSTİKtir (taktik): başlangıç ızgarası sabittir ve hamle
//  sonrası YENİ taş gelmez → "asgari hamle" iyi tanımlıdır ve çözüm garanti edilir.
//  (Doğrulama motoru tam aramadır → Uzman botun kalitesinden BAĞIMSIZ güvenilir.)
//
//  Üç tür:
//    • tile  — "N hamlede T karesini yap"      (hedef = ulaşılabilir kare)
//    • score — "N hamlede P puana ulaş"        (hedef = ulaşılabilir skor)
//    • clear — "N hamlede tahtayı aç: E boş"   (tıkanmış tahtayı kurtar)
//
//  Çalıştır:  node scripts/gen-puzzles.mjs
//  Çıktı:     src/app/logic/puzzles.data.ts  (PUZZLES: Puzzle[])
// ============================================================
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { writeFileSync, mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const out = await build({
  entryPoints: [resolve(ROOT, 'src/app/logic/ai.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'error',
});
const dir = mkdtempSync(join(tmpdir(), 'puzzlegen-'));
const file = join(dir, 'ai.mjs');
writeFileSync(file, out.outputFiles[0].text);
const { simulateMove, placeTile, mulberry32 } = await import(pathToFileURL(file).href);
unlinkSync(file);

const N = 4;
const DIRS = ['up', 'down', 'left', 'right']; // Direction string enum değerleri
const MOVE_CHAR = { up: 'U', down: 'D', left: 'L', right: 'R' };

// --- Izgara yardımcıları ------------------------------------
const clone = (g) => g.map((r) => r.slice());
const emptyGrid = () => Array.from({ length: N }, () => Array.from({ length: N }, () => 0));
const sig = (g) => g.map((r) => r.join(',')).join('|');
const maxTile = (g) => Math.max(...g.flat());
const emptyCount = (g) => g.flat().filter((v) => v === 0).length;
const fillRatio = (g) => (N * N - emptyCount(g)) / (N * N);
const legalDirs = (g) => DIRS.filter((d) => simulateMove(g, d).moved);

// --- Deterministik arama (TAŞ ÜRETİMİ YOK) ------------------

/**
 * Izgara-koşullu asgari çözüm: pred(grid) doğru olana kadar en KISA hamle
 * dizisi (BFS, gridSig ile ziyaret). Dönen: {minMoves, path} veya null.
 */
function solveGrid(start, pred, dmax) {
  if (pred(start)) return { minMoves: 0, path: '' };
  const seen = new Set([sig(start)]);
  let frontier = [{ g: start, path: '' }];
  for (let depth = 1; depth <= dmax; depth++) {
    const next = [];
    for (const node of frontier) {
      for (const d of DIRS) {
        const r = simulateMove(node.g, d);
        if (!r.moved) continue;
        const s = sig(r.grid);
        if (seen.has(s)) continue;
        const path = node.path + MOVE_CHAR[d];
        if (pred(r.grid)) return { minMoves: depth, path };
        seen.add(s);
        next.push({ g: r.grid, path });
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return null;
}

/** Bir gridSig'e ait ilk optimal çözümü başlatan FARKLI ilk hamle sayısı. */
function optimalFirstMoves(start, pred, minMoves) {
  if (minMoves <= 0) return 0;
  let count = 0;
  for (const d of legalDirs(start)) {
    const r = simulateMove(start, d);
    if (pred(r.grid) && minMoves === 1) {
      count++;
      continue;
    }
    const sol = solveGrid(r.grid, pred, minMoves - 1);
    if (sol && sol.minMoves === minMoves - 1) count++;
  }
  return count;
}

/** ≤K hamlede ulaşılabilecek EN YÜKSEK kümülatif skor (DFS, taş üretimi yok). */
function maxScoreIn(start, k) {
  let best = 0;
  const dfs = (g, moves, score) => {
    if (score > best) best = score;
    if (moves === 0) return;
    for (const d of DIRS) {
      const r = simulateMove(g, d);
      if (r.moved) dfs(r.grid, moves - 1, score + r.gained);
    }
  };
  dfs(start, k, 0);
  return best;
}

/** target puana ulaşmanın ASGARİ hamlesi + yolu (DFS, ≤dmax). null yoksa. */
function solveScore(start, target, dmax) {
  let best = null;
  const dfs = (g, moves, score, path) => {
    if (score >= target) {
      const used = path.length;
      if (!best || used < best.minMoves) best = { minMoves: used, path };
      return; // daha derine gitmek daha uzun yol → gerek yok
    }
    if (moves === 0) return;
    for (const d of DIRS) {
      const r = simulateMove(g, d);
      if (r.moved) dfs(r.grid, moves - 1, score + r.gained, path + MOVE_CHAR[d]);
    }
  };
  dfs(start, dmax, 0, '');
  return best;
}

// --- Aday pozisyon toplama (taş üretimiyle rastgele oyunlar) ---
function collectCandidates(rng, games, maxSteps) {
  const cands = [];
  const spawn = (g) => {
    const empties = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (g[r][c] === 0) empties.push([r, c]);
    if (!empties.length) return g;
    const [r, c] = empties[Math.floor(rng() * empties.length)];
    return placeTile(g, r, c, rng() < 0.1 ? 4 : 2);
  };
  for (let game = 0; game < games; game++) {
    let g = emptyGrid();
    g = spawn(spawn(g));
    for (let step = 0; step < maxSteps; step++) {
      const legal = legalDirs(g);
      if (!legal.length) break;
      const d = legal[Math.floor(rng() * legal.length)];
      g = simulateMove(g, d).grid;
      g = spawn(g);
      // İlginç aralık: ne çok boş ne tıkanmış; belirli adımlardan sonra topla.
      if (step >= 6 && emptyCount(g) >= 1) cands.push(clone(g));
    }
  }
  return cands;
}

// --- Bulmaca üretimi ----------------------------------------

/** BİRLEŞMEYLE ulaşılabilecek EN YÜKSEK kare (>başlangıç) + asgari hamle. */
function reachHighestTile(start, dmax) {
  const startMax = maxTile(start);
  let best = null; // {tile}
  const seen = new Set([sig(start)]);
  let frontier = [start];
  for (let depth = 1; depth <= dmax; depth++) {
    const next = [];
    for (const g of frontier) {
      for (const d of DIRS) {
        const r = simulateMove(g, d);
        if (!r.moved) continue;
        const s = sig(r.grid);
        if (seen.has(s)) continue;
        seen.add(s);
        const mt = maxTile(r.grid);
        if (mt > startMax && (!best || mt > best.tile)) best = { tile: mt };
        next.push(r.grid);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return best;
}

/** Ulaşılabilecek EN FAZLA boş hücre (>başlangıç). */
function reachHighestEmpty(start, dmax) {
  const startEmpty = emptyCount(start);
  let best = startEmpty;
  const seen = new Set([sig(start)]);
  let frontier = [start];
  for (let depth = 1; depth <= dmax; depth++) {
    const next = [];
    for (const g of frontier) {
      for (const d of DIRS) {
        const r = simulateMove(g, d);
        if (!r.moved) continue;
        const s = sig(r.grid);
        if (seen.has(s)) continue;
        seen.add(s);
        best = Math.max(best, emptyCount(r.grid));
        next.push(r.grid);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return best;
}

/**
 * Bir ızgaradan üretilebilecek TÜM geçerli bulmaca seçeneklerini döndürür
 * (dengeli seçim ana akışta yapılır). Her seçenek doğrulanmış minMoves taşır.
 */
function mintOptions(grid, rng) {
  const opts = [];
  const fill = fillRatio(grid);
  const curMax = maxTile(grid);
  const curEmpty = emptyCount(grid);

  // TILE — birleşmeyle ulaşılabilir en yüksek kareyi 2-6 hamlede yap.
  if (curMax >= 8) {
    const reach = reachHighestTile(grid, 6);
    if (reach) {
      const pred = (g) => maxTile(g) >= reach.tile;
      const sol = solveGrid(grid, pred, 6);
      if (sol && sol.minMoves >= 2) {
        const ofm = optimalFirstMoves(grid, pred, sol.minMoves);
        if (ofm <= 2) {
          opts.push({
            type: 'tile',
            target: reach.tile,
            minMoves: sol.minMoves,
            moveBudget: sol.minMoves + (sol.minMoves >= 4 ? 1 : 0),
            solution: sol.path,
            fill,
          });
        }
      }
    }
  }

  // CLEAR — tıkanmış tahtayı aç: boş hücreyi belirgin biçimde artır.
  if (fill >= 0.55 && curEmpty <= 5) {
    const reachE = reachHighestEmpty(grid, 6);
    const targetEmpty = Math.min(reachE, curEmpty + 3);
    if (targetEmpty >= curEmpty + 2) {
      const pred = (g) => emptyCount(g) >= targetEmpty;
      const sol = solveGrid(grid, pred, 6);
      if (sol && sol.minMoves >= 2) {
        const ofm = optimalFirstMoves(grid, pred, sol.minMoves);
        if (ofm <= 2) {
          opts.push({
            type: 'clear',
            target: targetEmpty,
            minMoves: sol.minMoves,
            moveBudget: sol.minMoves + 1,
            solution: sol.path,
            fill,
          });
        }
      }
    }
  }

  // SCORE — K hamlede ulaşılabilir yüksek skora ulaş (optimumun ~%80'i).
  if (fill >= 0.4) {
    const K = 5 + Math.floor(rng() * 3); // 5..7
    const maxS = maxScoreIn(grid, K);
    if (maxS >= 64) {
      const target = Math.max(32, Math.round((maxS * 0.8) / 16) * 16);
      const sol = solveScore(grid, target, K);
      if (sol && sol.minMoves >= 2) {
        opts.push({
          type: 'score',
          target,
          minMoves: sol.minMoves,
          moveBudget: K,
          solution: sol.path,
          fill,
        });
      }
    }
  }
  return opts;
}

// --- Ana akış -----------------------------------------------
const rng = mulberry32(0x50525a4c); // sabit tohum → tekrar üretilebilir
const candidates = collectCandidates(rng, 240, 60);

const minted = [];
const seenGrids = new Set();
const typeCount = { tile: 0, score: 0, clear: 0 };
const rawCount = { tile: 0, score: 0, clear: 0 };
for (const grid of candidates) {
  const s = sig(grid);
  if (seenGrids.has(s)) continue;
  seenGrids.add(s);
  const opts = mintOptions(grid, rng);
  for (const o of opts) rawCount[o.type]++;
  if (!opts.length) continue;
  // Denge: bu ızgaranın seçenekleri arasında EN AZ üretilen türü seç.
  opts.sort((a, b) => typeCount[a.type] - typeCount[b.type]);
  const p = opts[0];
  typeCount[p.type]++;
  minted.push({ grid, ...p });
}
console.error(
  `Ham seçenek sayıları: tile=${rawCount.tile} score=${rawCount.score} clear=${rawCount.clear}`,
);

// Türler arası KIYASLANABİLİR zorluk: asgari hamle (baskın) + doluluk.
// (Türe özel hedef büyüklüğü kıyaslanamaz; minMoves en iyi ortak ölçüdür.)
const difficulty = (p) => p.minMoves * 100 + Math.round(p.fill * 40);

/** Sıralı diziden zorluk yelpazesine yayılmış k öğe (kolay→zor). */
const evenSample = (arr, k) => {
  if (arr.length <= k) return arr.slice();
  const out = [];
  for (let i = 0; i < k; i++) out.push(arr[Math.floor((i * (arr.length - 1)) / (k - 1))]);
  return out;
};

// Her türü kendi içinde zorluğa göre sırala, sonra yelpazeye yayarak dengeli seç.
const PICK = 42;
const perType = Math.ceil(PICK / 3);
const byTypeArr = { tile: [], score: [], clear: [] };
for (const p of minted) byTypeArr[p.type].push(p);
let pool = [];
for (const t of ['tile', 'score', 'clear']) {
  byTypeArr[t].sort((a, b) => difficulty(a) - difficulty(b));
  pool.push(...evenSample(byTypeArr[t], perType));
}
// Eksik kalırsa (bir tür azsa) kalanlardan zorluk sırasıyla tamamla.
if (pool.length < PICK) {
  const rest = minted
    .filter((p) => !pool.includes(p))
    .sort((a, b) => difficulty(a) - difficulty(b));
  pool.push(...rest.slice(0, PICK - pool.length));
}
// Bölüm sırası: artan zorluk (türler karışık).
pool.sort((a, b) => difficulty(a) - difficulty(b));
const chosen = pool.slice(0, PICK);

// Bölüm yapısı: 6'şarlı bölümler (artan zorluk).
const puzzles = chosen.map((p, i) => ({
  id: 'p' + String(i + 1).padStart(3, '0'),
  type: p.type,
  section: Math.floor(i / 6) + 1,
  grid: p.grid,
  target: p.target,
  minMoves: p.minMoves,
  moveBudget: p.moveBudget,
  solution: p.solution,
}));

// --- Doğrulama (yazmadan önce): her bulmaca ÇÖZÜLEBİLİR + hedef minMoves ---
const byType = { tile: 0, score: 0, clear: 0 };
for (const p of puzzles) {
  byType[p.type]++;
  const pred =
    p.type === 'tile'
      ? (g) => maxTile(g) >= p.target
      : p.type === 'clear'
        ? (g) => emptyCount(g) >= p.target
        : null;
  if (pred) {
    const sol = solveGrid(p.grid, pred, p.moveBudget);
    if (!sol || sol.minMoves !== p.minMoves) {
      console.error(`DOĞRULAMA HATASI ${p.id}: minMoves uyuşmuyor`);
      process.exit(1);
    }
  } else {
    const sol = solveScore(p.grid, p.target, p.moveBudget);
    if (!sol) {
      console.error(`DOĞRULAMA HATASI ${p.id}: skor hedefi çözülemedi`);
      process.exit(1);
    }
  }
}

if (puzzles.length < 30) {
  console.error(`YETERSİZ: yalnızca ${puzzles.length} bulmaca üretildi (≥30 gerekli)`);
  process.exit(1);
}

// --- Veri dosyasını yaz -------------------------------------
const header = `// OTOMATİK ÜRETİLDİ — scripts/gen-puzzles.mjs (elle düzenleme).
// Motor üretimi + tam-arama doğrulamalı bulmacalar. Her biri DETERMİNİSTİK
// (taş üretimi yok): asgari çözüm hamlesi (minMoves) ve tek çözüm yolu motorla
// doğrulanmıştır. Yeniden üretmek için: node scripts/gen-puzzles.mjs
import type { Puzzle } from './puzzle.model';

export const PUZZLES: readonly Puzzle[] = ${JSON.stringify(puzzles)} as const;
`;
const dest = resolve(ROOT, 'src/app/logic/puzzles.data.ts');
writeFileSync(dest, header);

console.log(`Yazıldı: ${dest}`);
console.log(
  `${puzzles.length} bulmaca — tür dağılımı: tile=${byType.tile} score=${byType.score} clear=${byType.clear}`,
);
console.log(`Bölüm sayısı: ${Math.max(...puzzles.map((p) => p.section))}`);
console.log(
  `Adaylar: ${candidates.length}, üretilen: ${minted.length}, seçilen: ${puzzles.length}`,
);
console.log('Tüm bulmacalar çözülebilirliği + asgari hamlesi doğrulanmış ✓');
