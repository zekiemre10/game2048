// ============================================================
//  YZ zorluk ölçüm betiği (scripts/ai-bench.mjs)
//
//  GERÇEK motoru (src/app/logic/ai.ts) esbuild ile derleyip her seviye
//  için N tam oyun oynatır; ortalama skor, en büyük kare dağılımı ve
//  hamle başına süreyi raporlar.
//
//  Çalıştır:  node scripts/ai-bench.mjs [oyunSayisi] [seviyeler]
//    örn:     node scripts/ai-bench.mjs 30 easy,medium,expert
// ============================================================
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// --- Gerçek ai.ts'i belleğe derle ve içe aktar ---
async function loadEngine() {
  const out = await build({
    entryPoints: [resolve(ROOT, 'src/app/logic/ai.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'error',
  });
  const dir = mkdtempSync(join(tmpdir(), 'aibench-'));
  const file = join(dir, 'ai.mjs');
  writeFileSync(file, out.outputFiles[0].text);
  const mod = await import(pathToFileURL(file).href);
  unlinkSync(file);
  return mod;
}

// --- Tek oyun oyna (rng verilirse tohumlu → eşli karşılaştırma) ---
function playGame(engine, level, size, rng) {
  const { bestMove, simulateMove, emptyCells, placeTile } = engine;
  const rand = rng || Math.random;
  let g = Array.from({ length: size }, () => new Array(size).fill(0));

  const spawn = () => {
    const cells = emptyCells(g);
    if (!cells.length) return;
    const [r, c] = cells[Math.floor(rand() * cells.length)];
    g = placeTile(g, r, c, rand() < 0.1 ? 4 : 2);
  };
  spawn();
  spawn();

  let score = 0;
  let moves = 0;
  let totalMoveMs = 0;

  for (let step = 0; step < 20000; step++) {
    const t0 = performance.now();
    const dir = bestMove(g, level, rand);
    totalMoveMs += performance.now() - t0;
    if (!dir) break; // hamle kalmadı
    const res = simulateMove(g, dir);
    if (!res.moved) break; // güvenlik
    g = res.grid;
    score += res.gained;
    moves++;
    spawn();
  }

  let maxTile = 0;
  for (const row of g) for (const v of row) if (v > maxTile) maxTile = v;
  return { score, maxTile, moves, msPerMove: moves ? totalMoveMs / moves : 0 };
}

function mean(a) {
  return a.reduce((s, x) => s + x, 0) / a.length;
}
function pct(a, p) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

async function main() {
  const N = Number(process.argv[2] || 30);
  const levels = (process.argv[3] || 'easy,medium,expert').split(',');
  // Eşli mod: tüm seviyeler AYNI tohum dizisini oynar → varyans düşer,
  // "%20 daha iyi" farkı güvenilir ölçülür. (mulberry32, sabit tohumlar.)
  const paired = process.argv[4] === 'paired';
  const size = 4;

  const engine = await loadEngine();
  const seeds = Array.from({ length: N }, (_, i) => (0x1234 + i * 2654435761) >>> 0);
  console.log(
    `\nYZ ÖLÇÜM — ${size}×${size}, seviye başına ${N} tam oyun` +
      `${paired ? ' (EŞLİ: aynı tohumlar)' : ''}\n`,
  );
  console.log(
    'Seviye  | Ort.skor | Medyan | En büyük kare dağılımı            | 2048% | ms/hamle | maxMs',
  );
  console.log('-'.repeat(98));

  const results = {};
  const perGame = {};
  for (const level of levels) {
    const games = [];
    const tStart = performance.now();
    for (let i = 0; i < N; i++) {
      const rng = paired ? engine.mulberry32(seeds[i]) : null;
      games.push(playGame(engine, level, size, rng));
      process.stderr.write(
        `\r  ${level}: ${i + 1}/${N} oyun (${((performance.now() - tStart) / 1000).toFixed(0)}s)   `,
      );
    }
    process.stderr.write('\r' + ' '.repeat(50) + '\r');
    perGame[level] = games.map((g) => g.score);

    const scores = games.map((g) => g.score);
    const tiles = games.map((g) => g.maxTile);
    const ms = games.map((g) => g.msPerMove);
    const reach2048 = (tiles.filter((t) => t >= 2048).length / N) * 100;

    // En büyük kare dağılımı
    const dist = {};
    for (const t of tiles) dist[t] = (dist[t] || 0) + 1;
    const distStr = Object.keys(dist)
      .map(Number)
      .sort((a, b) => a - b)
      .map((t) => `${t}:${dist[t]}`)
      .join(' ');

    results[level] = { avg: mean(scores), reach2048, msPerMove: mean(ms) };
    console.log(
      `${level.padEnd(7)} | ${String(Math.round(mean(scores))).padStart(8)} | ` +
        `${String(Math.round(pct(scores, 0.5))).padStart(6)} | ${distStr.padEnd(33)} | ` +
        `${reach2048.toFixed(0).padStart(4)}% | ${mean(ms).toFixed(2).padStart(7)} | ` +
        `${Math.max(...ms).toFixed(1)}`,
    );
  }

  // Uzman > Orta kontrolü
  if (results.expert && results.medium) {
    const gain = ((results.expert.avg - results.medium.avg) / results.medium.avg) * 100;
    console.log('\n' + '-'.repeat(60));
    console.log(
      `Uzman vs Orta (ortalama): ${gain >= 0 ? '+' : ''}${gain.toFixed(1)}% ` +
        `(${gain >= 20 ? 'HEDEF SAGLANDI ✓ (>=%20)' : 'YETERSIZ ✗ (<%20)'})`,
    );
    // Eşli mod: aynı tohumda Uzman kaç oyunda Orta'yı geçti (varyanstan bağımsız)
    if (paired) {
      const e = perGame.expert, m = perGame.medium;
      let wins = 0, ratioSum = 0;
      for (let i = 0; i < e.length; i++) {
        if (e[i] > m[i]) wins++;
        ratioSum += m[i] > 0 ? e[i] / m[i] : 1;
      }
      const medianRatio = (() => {
        const r = e.map((x, i) => (m[i] > 0 ? x / m[i] : 1)).sort((a, b) => a - b);
        return r[Math.floor(r.length / 2)];
      })();
      console.log(
        `Eşli: Uzman ${wins}/${e.length} oyunda Orta'yı geçti · ` +
          `ort. oran ${(ratioSum / e.length).toFixed(2)}× · medyan oran ${medianRatio.toFixed(2)}×`,
      );
    }
    console.log(
      `Uzman ms/hamle: ${results.expert.msPerMove.toFixed(2)} ` +
        `(${results.expert.msPerMove <= 30 ? '30ms altinda ✓' : '30ms USTUNDE ✗'})`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
